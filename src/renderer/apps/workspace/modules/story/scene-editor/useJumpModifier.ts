import { useSyncExternalStore } from "react";

/**
 * Whether the "follow this word" modifier is held right now — Ctrl on Windows and Linux, Cmd on
 * macOS, and either one everywhere, exactly as the row's own multi-select gesture already reads it.
 *
 * A pointing word on a committed row cannot ANNOUNCE that it points at something: this product's
 * rows carry no explanatory text and no native tooltip (a native tooltip covers the very pixels the
 * author is aiming at). So the whole affordance is this modifier — hold it and every word that leads
 * somewhere takes the link colour and the hand cursor, release it and the row is a row again.
 *
 * **A module-level store rather than a hook per component.** A scene is hundreds of rows, and while
 * the list is windowed a screenful still holds dozens of pointing words. One set of window listeners
 * shared by every token is what keeps pressing Ctrl from installing (and tearing down) a listener per
 * word; `useSyncExternalStore` then re-renders only the tokens themselves, never the rows around
 * them, because the tokens are the only subscribers.
 *
 * **`blur` is not optional.** Holding Ctrl while switching windows — Alt+Tab, a click on the
 * inspector's native file dialog, Cmd+Tab on macOS — releases the key somewhere this window never
 * hears, so the `keyup` never arrives. Without the blur reset the scene stays lit up as one screen of
 * links until the author happens to tap and release a modifier again, which is a state nobody would
 * connect back to the key they pressed a minute ago.
 */

let held = false;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
    if (next === held) {
        return;
    }
    held = next;
    for (const listener of listeners) {
        listener();
    }
}

// Read off the event's own modifier flags rather than off `event.key`, so the state is right no
// matter which key was pressed: holding Ctrl and then typing a letter keeps it held, and a `keyup`
// for Control reports the flag already cleared.
function onKey(event: KeyboardEvent): void {
    publish(event.ctrlKey || event.metaKey);
}

function onBlur(): void {
    publish(false);
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) {
        // Capture phase: a row's text field and the command line both stop keystrokes on their way
        // up, and a modifier the editor never learns about is a scene full of dead words.
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("keyup", onKey, true);
        window.addEventListener("blur", onBlur);
    }
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("keyup", onKey, true);
            window.removeEventListener("blur", onBlur);
            // Nothing is watching, so nothing has to be told — but the next surface to mount must not
            // inherit a modifier that was held in a scene editor that is now closed.
            held = false;
        }
    };
}

/** Subscribe this component to the modifier. Re-renders only on the press and the release. */
export function useJumpModifierHeld(): boolean {
    return useSyncExternalStore(subscribe, () => held, () => false);
}

/** Whether a pointer gesture asked to follow the word rather than to act on it. */
export function isJumpModifierEvent(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
    return event.ctrlKey || event.metaKey;
}
