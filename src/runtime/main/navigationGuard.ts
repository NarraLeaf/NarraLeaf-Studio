import { GAME_RUNTIME_PROTOCOL } from "@shared/types/gameRuntime";

/*
 * What the game window is allowed to be, and who is allowed to talk to this process.
 *
 * The game's page is served from `nlgame://runtime/` and nowhere else. A game that allows HTTP can
 * show remote content, and without these gates one link, one redirect or one `window.open` would
 * put a remote page into the window that holds the preload - and every channel below answers that
 * window, `runtime:read-pack` included. So: the top frame never leaves the runtime origin, no new
 * windows are made (links that should open go through the decided `openExternal` path), no
 * webviews are attached, and an IPC message is only answered when the frame that sent it is the
 * runtime document.
 */

const RUNTIME_HOST = "runtime";

/** Whether `url` is a document of the game runtime itself (`nlgame://runtime/...`). */
export function isRuntimeDocumentUrl(url: string | null | undefined): boolean {
    if (typeof url !== "string" || url.length === 0) {
        return false;
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return parsed.protocol === `${GAME_RUNTIME_PROTOCOL}:` && parsed.hostname === RUNTIME_HOST;
}

/** The shape of an IPC event this guard reads; Electron's events carry more. */
export interface RuntimeIpcSenderLike {
    senderFrame?: { url?: string } | null;
}

/**
 * Whether an IPC message came from the runtime document. A frame that has gone (`senderFrame` is
 * null once it navigated or was destroyed) is refused: there is no longer anyone to answer.
 */
export function isTrustedRuntimeSender(event: RuntimeIpcSenderLike | null | undefined): boolean {
    const frame = event?.senderFrame;
    if (!frame) {
        return false;
    }
    return isRuntimeDocumentUrl(frame.url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the shape of every ipcMain listener
type Listener = (event: any, ...args: any[]) => unknown;

/** The part of `ipcMain` this guard wraps. */
export interface GuardableIpcMain {
    handle(channel: string, listener: Listener): void;
    handleOnce(channel: string, listener: Listener): void;
    on(channel: string, listener: Listener): unknown;
    once(channel: string, listener: Listener): unknown;
}

const INSTALLED = Symbol.for("narraleaf.runtime.ipcSenderGuard");

/**
 * Wraps every listener registered on `ipc` from now on so it only runs for a trusted sender.
 *
 * Done at the registration point rather than in each handler so a channel added later cannot be
 * forgotten. An invoke from an untrusted frame rejects; a plain message is dropped.
 */
export function installRuntimeIpcSenderGuard(
    ipc: GuardableIpcMain,
    onRefused: (channel: string, url: string | null) => void = () => undefined,
    isTrusted: (event: RuntimeIpcSenderLike) => boolean = isTrustedRuntimeSender,
): void {
    const marked = ipc as GuardableIpcMain & { [INSTALLED]?: true };
    if (marked[INSTALLED]) {
        return;
    }
    marked[INSTALLED] = true;

    const senderUrl = (event: RuntimeIpcSenderLike): string | null => event?.senderFrame?.url ?? null;

    const wrapInvoke = (channel: string, listener: Listener): Listener =>
        ((event: RuntimeIpcSenderLike, ...args: unknown[]) => {
            if (!isTrusted(event)) {
                onRefused(channel, senderUrl(event));
                throw new Error(`IPC channel "${channel}" refused an untrusted sender.`);
            }
            return (listener as (...a: unknown[]) => unknown)(event, ...args);
        }) as Listener;

    const wrapMessage = (channel: string, listener: Listener): Listener =>
        ((event: RuntimeIpcSenderLike, ...args: unknown[]) => {
            if (!isTrusted(event)) {
                onRefused(channel, senderUrl(event));
                return undefined;
            }
            return (listener as (...a: unknown[]) => unknown)(event, ...args);
        }) as Listener;

    const handle = ipc.handle.bind(ipc);
    const handleOnce = ipc.handleOnce.bind(ipc);
    const on = ipc.on.bind(ipc);
    const once = ipc.once.bind(ipc);
    ipc.handle = (channel, listener) => handle(channel, wrapInvoke(channel, listener));
    ipc.handleOnce = (channel, listener) => handleOnce(channel, wrapInvoke(channel, listener));
    ipc.on = (channel, listener) => on(channel, wrapMessage(channel, listener));
    ipc.once = (channel, listener) => once(channel, wrapMessage(channel, listener));
}

/** The part of `webContents` the navigation guard needs. */
export interface GuardableWebContents {
    on(event: "will-navigate", listener: (event: { preventDefault(): void; url?: string }, url: string) => void): unknown;
    on(
        event: "will-redirect",
        listener: (event: { preventDefault(): void; url?: string; isMainFrame?: boolean }, url: string, isInPlace?: boolean, isMainFrame?: boolean) => void,
    ): unknown;
    on(event: "will-attach-webview", listener: (event: { preventDefault(): void }) => void): unknown;
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
}

/**
 * Keeps the game window on the runtime document: renderer-initiated navigations and main-frame
 * redirects to anywhere else are cancelled, new windows are denied, webviews are refused.
 * `loadURL` from this process (launch, the crash screen) does not pass through `will-navigate`.
 */
export function installRuntimeNavigationGuard(
    contents: GuardableWebContents,
    onBlocked: (kind: "navigate" | "redirect" | "window" | "webview", url: string) => void = () => undefined,
): void {
    contents.on("will-navigate", (event, url) => {
        const target = url ?? event.url ?? "";
        if (isRuntimeDocumentUrl(target)) {
            return;
        }
        event.preventDefault();
        onBlocked("navigate", target);
    });
    contents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
        const main = isMainFrame ?? event.isMainFrame ?? true;
        const target = url ?? event.url ?? "";
        if (!main || isRuntimeDocumentUrl(target)) {
            return;
        }
        event.preventDefault();
        onBlocked("redirect", target);
    });
    contents.on("will-attach-webview", event => {
        event.preventDefault();
        onBlocked("webview", "");
    });
    contents.setWindowOpenHandler(details => {
        onBlocked("window", details.url);
        return { action: "deny" };
    });
}
