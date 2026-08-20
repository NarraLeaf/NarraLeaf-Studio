/**
 * "Put the caret in the search box" - the half of ⇧⌘F that showing the panel does not cover.
 *
 * A window event rather than a call, because the two sides never meet: the shortcut lives in the
 * workspace shell and the input lives inside the panel, which the shell does not render and which
 * may not even be mounted yet when the key is pressed.
 *
 * The pending flag is what covers that second case. Revealing a hidden panel mounts it, and a mount
 * is a render later than the dispatch - so an event alone would arrive before anyone was listening
 * and the caret would stay where it was. The panel consumes the flag on mount instead; a request
 * nobody ever collects is spent by the next mount, which is harmless.
 */
export const SEARCH_FOCUS_REQUEST_EVENT = "narraleaf-studio:search-focus-request";

let pending = false;

/**
 * Ask the search panel for the caret. Call after making the panel visible.
 *
 * Dispatched on the next frame rather than now: the reveal that precedes it is a React state change,
 * so at this moment the input either does not exist or is still inside a hidden dock, and
 * `focus()` on either does nothing at all.
 */
export function requestSearchFocus(): void {
    pending = true;
    requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(SEARCH_FOCUS_REQUEST_EVENT));
    });
}

/** True once per request, for the panel to check when it mounts. */
export function consumeSearchFocusRequest(): boolean {
    const requested = pending;
    pending = false;
    return requested;
}
