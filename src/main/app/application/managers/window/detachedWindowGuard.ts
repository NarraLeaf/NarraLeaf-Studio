import { WindowAppType } from "@shared/types/window";

/**
 * The only `window.open` Studio allows: a detached editor.
 *
 * A detached editor is NOT a second renderer. The workspace opens a blank same-origin popup and
 * portals part of its own React tree into it, so the editor keeps the one service graph, the one
 * document instance and the one undo stack that the docked tab had. That is the whole reason the
 * popup must stay `about:blank`: the moment it loads a URL of its own it becomes a second renderer
 * on the same project files, which is the double-write this design exists to avoid.
 *
 * Everything else stays denied. `webContents.setWindowOpenHandler` is the last gate before a
 * renderer can conjure a window with the opener's webPreferences, so the frame name carries the
 * intent explicitly rather than being inferred from a URL that any injected script could produce.
 */
const DETACHED_FRAME_NAME_PREFIX = "nls-detached:";

/** Frame name for a detached window, given the caller's own key for it (e.g. an editor tab id). */
export function detachedWindowFrameName(key: string): string {
    return `${DETACHED_FRAME_NAME_PREFIX}${key}`;
}

/** Window types whose renderer may detach part of itself into a popup. */
const DETACHABLE_WINDOW_TYPES: ReadonlySet<WindowAppType> = new Set([WindowAppType.Workspace]);

export type DetachedWindowRequest = {
    url: string;
    frameName: string;
    windowType: WindowAppType;
};

export type DetachedWindowDecision =
    | { allowed: true; key: string }
    | { allowed: false; reason: string };

export function decideDetachedWindowOpen(request: DetachedWindowRequest): DetachedWindowDecision {
    if (!DETACHABLE_WINDOW_TYPES.has(request.windowType)) {
        return { allowed: false, reason: `The ${request.windowType} window cannot detach editors` };
    }

    // Electron reports `window.open("")` as "about:blank"; anything else is a load, not a detach.
    if (request.url !== "" && request.url !== "about:blank") {
        return { allowed: false, reason: "A detached window must stay blank" };
    }

    if (!request.frameName.startsWith(DETACHED_FRAME_NAME_PREFIX)) {
        return { allowed: false, reason: "Not a detached-window frame name" };
    }

    const key = request.frameName.slice(DETACHED_FRAME_NAME_PREFIX.length);
    if (!key) {
        return { allowed: false, reason: "A detached window needs a key" };
    }

    return { allowed: true, key };
}
