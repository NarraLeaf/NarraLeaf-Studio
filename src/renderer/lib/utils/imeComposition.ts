import type * as React from "react";

/**
 * IME (input-method) guards.
 *
 * While an input method is composing, the keyboard belongs to the candidate window, not to the
 * page. Enter confirms the conversion, Escape cancels it, the arrows walk the candidate list —
 * every one of them is a key the author or player is pressing *at the IME*. A handler that acts on
 * them anyway steals the keystroke: Escape throws away the line being written, Enter submits the
 * half-converted kana, the arrows move a selection instead of the candidate.
 *
 * Chromium marks those events - `isComposing` on the native event, and the legacy `keyCode === 229`
 * that some layouts still send - so any key handler bound to a text field can ask
 * {@link isImeKeyEvent} and return early. Latin typing never sets either flag, so the guard costs
 * nothing for authors who do not use an IME.
 *
 * Separately, composing on macOS opens a real native window, so the web contents fire `blur` on the
 * input *and* on `window`. Overlays that dismiss on blur ask {@link isComposingText} first, or they
 * tear their own input out from under the IME.
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
 * True when this key event is the IME's, not the handler's. Accepts both React's synthetic event
 * and a native one, because the same question gets asked from `onKeyDown` props and from `document`
 * listeners.
 */
export function isImeKeyEvent(event: React.KeyboardEvent | KeyboardEvent): boolean {
    const native = "nativeEvent" in event ? event.nativeEvent : event;
    return native.isComposing || native.keyCode === 229;
}

/**
 * Wrap a key handler so that keys belonging to a composition never reach it.
 *
 * The shared text fields put their callers' `onKeyDown` through this, which is why a form that
 * commits on Enter or cancels on Escape needs no guard of its own. Handlers bound directly to an
 * `<input>`, a `<textarea>` or a contentEditable still have to call {@link isImeKeyEvent}
 * themselves, as does anything listening for those keys on a container the fields sit inside -
 * the event still bubbles there.
 */
export function guardImeKeys<E extends Element>(
    handler: ((event: React.KeyboardEvent<E>) => void) | undefined,
): ((event: React.KeyboardEvent<E>) => void) | undefined {
    if (!handler) {
        return undefined;
    }
    return event => {
        if (isImeKeyEvent(event)) {
            return;
        }
        handler(event);
    };
}
