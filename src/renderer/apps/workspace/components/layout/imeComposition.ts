import type * as React from "react";

/**
 * IME (input-method) guards for the dismiss-on-blur overlays - the palette box and Quick Open.
 *
 * Composing CJK text opens a candidate window that, on macOS, is its own native window: the web
 * contents fire `blur` on the input *and* on `window` while the candidate list is up. An overlay that
 * closes on either signal tears its own input out from under the IME, so the candidate list
 * flashes and vanishes and nothing can be typed. Overlays therefore ask {@link isComposingText}
 * before acting on a blur, and ignore keys that belong to the IME rather than to the list.
 */

let composing = false;

/** Bind to an input's `onCompositionStart` / `onCompositionEnd`. */
export const compositionHandlers = {
    onCompositionStart: () => {
        composing = true;
    },
    onCompositionEnd: () => {
        composing = false;
    },
};

/** True while an IME composition is in progress anywhere in this window. */
export function isComposingText(): boolean {
    return composing;
}

/**
 * True when this key event is the IME's, not the list's. Enter/Escape/arrows all drive the
 * candidate window during composition and must not reach the overlay.
 */
export function isImeKeyEvent(event: React.KeyboardEvent): boolean {
    return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}
