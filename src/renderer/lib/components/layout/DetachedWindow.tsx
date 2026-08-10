import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HostWindowProvider } from "./hostWindow";

/**
 * A second OS window showing part of THIS window's React tree.
 *
 * Not a second renderer. `window.open("")` on a same-origin blank document gives the opener a
 * window it can write DOM into, so the subtree portalled in here is still the same React tree,
 * still inside every provider above it, still on the one workspace service graph. That is the
 * point: a blueprint editor in its own window edits the same in-memory document as the tab it came
 * from, with one undo stack and one autosave. A real second renderer would hold its own copy of
 * every document and the two would overwrite each other's saves.
 *
 * The main process only permits this exact shape - blank document, declared frame name, from a
 * window type that detaches editors. See `detachedWindowGuard` in the main process, and
 * `hostWindow` for the rule the subtree has to follow to work over there.
 *
 * What a detached window does NOT get, deliberately:
 * - a custom title bar. It wears the OS frame, because Studio's title-bar buttons act on "the
 *   window that sent this IPC" and a popup sends IPC through its opener.
 * - a preload bridge of its own (the preload refuses; see `preload.ts`).
 */
export type DetachedWindowProps = {
    /**
     * Stable identity for the popup, unique within the opener. Doubles as the frame name, so
     * asking twice for the same key reuses the window rather than opening a second one.
     */
    windowKey: string;
    /** The OS window title. */
    title: string;
    initialWidth?: number;
    initialHeight?: number;
    /** The window is gone - closed by the author, by the OS, or because opening it failed. */
    onClosed: () => void;
    children: ReactNode;
};

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;

/**
 * How long a teardown waits before it actually closes the window.
 *
 * Long enough to cover React's StrictMode remount, which arrives after a macrotask rather than
 * synchronously with the cleanup - at 0ms the throwaway first mount really did open a window and
 * close it again, which is a native window flashing on screen every time an editor is popped out.
 * The cost is that a genuine close (re-dock, window gone) happens a quarter second late, which
 * nobody can see.
 */
const CLOSE_DEFERRAL_MS = 250;

/** Marks a re-dispatched key event so the forwarder never picks up its own echo. */
const FORWARDED_KEY_FLAG = "__nlsForwardedFromDetachedWindow";

type OpenDetachedWindow = {
    win: Window;
    container: HTMLElement;
    /** Everything to undo when the window really goes away. */
    dispose: () => void;
    /** Pending teardown, cancelled if the same key is re-opened in the same tick (see below). */
    closeTimer: ReturnType<typeof setTimeout> | null;
    /**
     * True while WE are the ones closing the window.
     *
     * A window closing is normally the author's decision and gets reported as one - the editor
     * comes back to the workspace, or ends, per their setting. But this component closes windows
     * too (StrictMode's throwaway first mount, a re-dock, the opener navigating away), and those
     * closes must not be mistaken for that decision: reporting one releases the detached entry,
     * which unmounts this component, which closes the window that was actually alive. That cascade
     * is exactly how a pop-out ended up leaving no window and no tab.
     */
    selfClosing: boolean;
};

/**
 * Live popups by key.
 *
 * Module-level rather than per-component because React's StrictMode mounts every effect twice in
 * development: open, tear down, open again. Tearing a native window down and building it back is a
 * visible flash and loses the size the author just gave it, so teardown is deferred
 * (`CLOSE_DEFERRAL_MS`) and cancelled if the same key comes back - which, on a StrictMode remount,
 * it always does.
 */
const openWindows = new Map<string, OpenDetachedWindow>();

export function DetachedWindow({
    windowKey,
    title,
    initialWidth = DEFAULT_WIDTH,
    initialHeight = DEFAULT_HEIGHT,
    onClosed,
    children,
}: DetachedWindowProps) {
    const [opened, setOpened] = useState<OpenDetachedWindow | null>(null);
    // Read through a ref: the open effect runs once per key and must not re-run (and re-open a
    // window) because the caller passed a fresh callback on a later render.
    const onClosedRef = useRef(onClosed);
    onClosedRef.current = onClosed;

    useEffect(() => {
        const existing = openWindows.get(windowKey);
        if (existing && !existing.win.closed) {
            if (existing.closeTimer !== null) {
                clearTimeout(existing.closeTimer);
                existing.closeTimer = null;
            }
            setOpened(existing);
            return () => scheduleClose(windowKey);
        }

        const created = openDetachedWindow(windowKey, { title, width: initialWidth, height: initialHeight });
        if (!created) {
            // Chromium refused the popup, or the main process denied it. Nothing to portal into,
            // and the caller has to put the editor back where it came from.
            onClosedRef.current();
            return;
        }

        openWindows.set(windowKey, created);
        setOpened(created);

        const onGone = () => {
            if (openWindows.get(windowKey) === created) {
                openWindows.delete(windowKey);
            }
            const wasSelfClosing = created.selfClosing;
            created.dispose();
            if (!wasSelfClosing) {
                onClosedRef.current();
            }
        };
        created.win.addEventListener("pagehide", onGone);
        created.dispose = chain(created.dispose, () => created.win.removeEventListener("pagehide", onGone));
        // A window closed by its OS button fires `pagehide` in every browser Studio ships on, but
        // the poll is the backstop for the paths that do not (the opener being told to close it,
        // a crash of the popup's own frame): a detached editor that has silently lost its window
        // would otherwise never come back to the workspace.
        const poll = window.setInterval(() => {
            if (created.win.closed) {
                window.clearInterval(poll);
                onGone();
            }
        }, 500);
        const stopPoll = () => window.clearInterval(poll);
        created.dispose = chain(created.dispose, stopPoll);

        return () => scheduleClose(windowKey);
        // Title and size are applied at open time only: resizing or renaming an author's window
        // out from under them is worse than a stale title, and the title is kept live below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [windowKey]);

    useEffect(() => {
        if (opened && !opened.win.closed) {
            opened.win.document.title = title;
        }
    }, [opened, title]);

    if (!opened) {
        return null;
    }

    return createPortal(
        <HostWindowProvider window={opened.win} windowKey={windowKey}>{children}</HostWindowProvider>,
        opened.container,
    );
}

/**
 * Bring an already-open detached window forward.
 *
 * The caller that navigates to an editor - a diagnostic, a link from a widget - has to reach the
 * window the editor is actually in; without this it would open a second copy in the workspace and
 * leave the author looking at the one that did not move.
 */
export function focusDetachedWindow(windowKey: string): boolean {
    const entry = openWindows.get(windowKey);
    if (!entry || entry.win.closed) {
        return false;
    }
    entry.win.focus();
    return true;
}

function scheduleClose(windowKey: string): void {
    const entry = openWindows.get(windowKey);
    if (!entry || entry.closeTimer !== null) {
        return;
    }
    entry.closeTimer = setTimeout(() => {
        if (openWindows.get(windowKey) === entry) {
            openWindows.delete(windowKey);
        }
        entry.selfClosing = true;
        entry.dispose();
        entry.win.close();
    }, CLOSE_DEFERRAL_MS);
}

function openDetachedWindow(
    windowKey: string,
    options: { title: string; width: number; height: number },
): OpenDetachedWindow | null {
    const features = `width=${Math.round(options.width)},height=${Math.round(options.height)}`;
    const win = window.open("", detachedFrameName(windowKey), features);
    if (!win) {
        return null;
    }

    const doc = win.document;
    doc.title = options.title;
    doc.documentElement.lang = document.documentElement.lang;

    const container = doc.createElement("div");
    container.className = "h-screen w-screen overflow-hidden";
    doc.body.appendChild(container);

    const disposers: Array<() => void> = [];
    const entry: OpenDetachedWindow = {
        win,
        container,
        dispose: () => disposers.forEach(fn => fn()),
        closeTimer: null,
        selfClosing: false,
    };

    disposers.push(adoptStyles(doc));
    disposers.push(mirrorRootAttributes(doc));
    disposers.push(forwardKeyEvents(doc));
    disposers.push(closeWithOpenerDocument(entry));

    return entry;
}

/** Must match `detachedWindowFrameName` in the main process, which gates the popup. */
function detachedFrameName(windowKey: string): string {
    return `nls-detached:${windowKey}`;
}

/**
 * Take the popup down with the document that draws it.
 *
 * Chromium closes a popup when its opener WINDOW closes, but not when the opener merely navigates -
 * and a workspace renderer does reload itself: the dev server's hot reload, recovery mode, the
 * workspace reload service. What survives such a reload is a window full of DOM nobody owns any
 * more: React is gone, so nothing in it responds, and the reloaded workspace has no record of it,
 * so the editor is neither a tab nor a window. Closing it hands the editor back through the normal
 * path instead.
 */
function closeWithOpenerDocument(entry: OpenDetachedWindow): () => void {
    const close = () => {
        // Ours, not the author's: nobody is left to hear a report anyway, and the flag is what
        // keeps the closing window from being read as a decision to put the editor back.
        entry.selfClosing = true;
        entry.win.close();
    };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
}

/**
 * Give the blank document the opener's stylesheets.
 *
 * Rebuilt rather than `cloneNode`d so a relative href resolves against the opener's base rather
 * than against `about:blank`, where it would resolve to nothing and the window would open
 * unstyled. Kept live because a dev build replaces the stylesheet on every hot reload.
 */
function adoptStyles(doc: Document): () => void {
    const copyAll = () => {
        doc.head.querySelectorAll("[data-nl-adopted-style]").forEach(node => node.remove());
        document.head.querySelectorAll<HTMLElement>("link[rel='stylesheet'], style").forEach((source) => {
            const copy = doc.createElement(source.tagName.toLowerCase());
            copy.setAttribute("data-nl-adopted-style", "");
            if (source instanceof HTMLLinkElement) {
                (copy as HTMLLinkElement).rel = "stylesheet";
                (copy as HTMLLinkElement).href = source.href;
            } else {
                copy.textContent = source.textContent;
            }
            doc.head.appendChild(copy);
        });
    };

    copyAll();
    const observer = new MutationObserver(copyAll);
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
}

/**
 * Keep the popup's root element wearing what the opener's wears.
 *
 * `class` and inline custom properties on `<html>` are how Studio publishes appearance - the
 * `nl-studio` light-theme opt-in, the accent colour, reduced motion, editor surface opacity (see
 * lib/appearance). They change while the app runs, so this mirrors rather than copies once.
 */
function mirrorRootAttributes(doc: Document): () => void {
    const source = document.documentElement;
    const target = doc.documentElement;
    const sync = () => {
        target.className = source.className;
        target.setAttribute("style", source.getAttribute("style") ?? "");
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(source, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
}

/**
 * Re-dispatch the popup's key events into the opener's document.
 *
 * Studio's keybindings and React Flow's own key handling both listen on the document their module
 * was loaded in - the opener's - so without this, Delete deletes no node and no shortcut works in
 * a detached editor. The subtree's own listeners run first (they are on this document, and this
 * runs at the bubble phase on its root), so anything already handled here is not forwarded twice.
 *
 * Not forwarded while the author is typing: a plain Delete belongs to the text field under the
 * caret, and over there the opener would judge it against ITS focused element - the workspace body
 * - decide nothing is being edited, and delete the selected nodes instead.
 */
function forwardKeyEvents(doc: Document): () => void {
    const forward = (event: KeyboardEvent) => {
        if (event.defaultPrevented || (event as unknown as Record<string, unknown>)[FORWARDED_KEY_FLAG]) {
            return;
        }
        if (isEditableTarget(doc.activeElement)) {
            return;
        }

        const echo = new KeyboardEvent(event.type, {
            key: event.key,
            code: event.code,
            location: event.location,
            repeat: event.repeat,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(echo, FORWARDED_KEY_FLAG, { value: true });
        const handled = !document.dispatchEvent(echo);
        if (handled) {
            event.preventDefault();
        }
    };

    doc.addEventListener("keydown", forward);
    doc.addEventListener("keyup", forward);
    return () => {
        doc.removeEventListener("keydown", forward);
        doc.removeEventListener("keyup", forward);
    };
}

/**
 * Cross-realm safe: the popup's elements are built by the popup's document, so they are NOT
 * instances of this realm's `HTMLInputElement` however much they look like one.
 */
function isEditableTarget(node: Element | null): boolean {
    if (!node) {
        return false;
    }
    const tag = node.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return true;
    }
    return (node as HTMLElement).isContentEditable === true;
}

function chain(first: () => void, second: () => void): () => void {
    return () => {
        first();
        second();
    };
}
