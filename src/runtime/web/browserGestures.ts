/**
 * The gestures a browser keeps for itself, taken away from a game that has no use for them.
 *
 * The CSS half of this lives in the exported entry document (`buildWebIndexHtml`), where
 * `touch-action` and `overscroll-behavior` remove double-tap zoom and pull-to-refresh from every
 * element in one line each. This is the half CSS cannot state:
 *
 *  - **Safari's pinch.** iOS and macOS Safari raise their own `gesture*` events for a two-finger
 *    zoom, and WebKit acts on them without consulting `touch-action` at all. Cancelling them is
 *    what makes the CSS ban hold on a phone rather than only on Chrome - so it is cancelled only
 *    where the ban applies. The mobile shells run full-screen with no chrome to zoom back out
 *    with; a browser window has both, and there a pinch is visual zoom, which magnifies what is
 *    drawn without re-laying anything out. Taking that away would be taking away the browser
 *    rather than protecting the game, so the web target keeps it - trackpad pinch included.
 *  - **The long-press / right-click menu.** A menu offering "Reload" and "Open in New Tab" over a
 *    running game is browser chrome that the shells otherwise have none of - and on Android it is
 *    what a long press on the dialogue produces. That one is cancelled on every host: unlike zoom
 *    it shows the player nothing they came for. Editable fields keep theirs: a name-entry box
 *    without Paste would be worse than the menu ever was.
 *
 * Both mobile shells serve the very same site as the web target, so one file covers all three and
 * the document says which one is running it (`WEB_SHELL_VARIANT_META`). The native shells already
 * refuse what only they can (zoom controls, WebView bounce, the iOS link preview and the system
 * gestures at the screen edges); nothing here duplicates that, and nothing here depends on it
 * either - a web export played in a phone browser gets the treatment its host earns.
 *
 * A separate module rather than a few lines inside `web.ts`, which installs itself on `window` at
 * import and so cannot be brought into a test.
 *
 * Comments in English per project convention.
 */

/** The part of `window`/`document` this needs; the browser's carries more. */
export interface BrowserGestureHost {
    addEventListener(
        type: string,
        listener: (event: BrowserGestureEvent) => void,
        options?: { passive?: boolean },
    ): void;
}

/** The part of an `Event` this reads. `target` is typed loosely so a test can pass a plain object. */
export interface BrowserGestureEvent {
    target?: unknown;
    preventDefault(): void;
}

export interface BrowserGestureOptions {
    /**
     * Whether a two-finger zoom belongs to the browser or to nobody. True in the phone shells,
     * where a zoomed-in player has no way back; false on the web, where zoom is the reader's.
     */
    blockPinch: boolean;
}

/**
 * Where a context menu is still the right answer. `select` is listed for the same reason as the
 * text inputs: a native picker is the browser's own menu, and suppressing it leaves nothing behind.
 */
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

/** Safari's own pinch-zoom events, which are not part of the touch-action contract. */
const PINCH_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

export function installBrowserGestureGuards(host: BrowserGestureHost, options: BrowserGestureOptions): void {
    if (options.blockPinch) {
        for (const type of PINCH_EVENTS) {
            // `passive: false` is load-bearing: a listener a browser assumed to be passive has its
            // preventDefault() ignored, and these events are close enough to touch events that some
            // engines make that assumption.
            host.addEventListener(type, event => {
                event.preventDefault();
            }, { passive: false });
        }
    }

    host.addEventListener("contextmenu", event => {
        if (isEditableTarget(event.target)) {
            return;
        }
        event.preventDefault();
    });
}

function isEditableTarget(target: unknown): boolean {
    const element = target as { closest?: (selectors: string) => unknown } | null | undefined;
    if (typeof element?.closest !== "function") {
        return false;
    }
    return element.closest(EDITABLE_SELECTOR) != null;
}
