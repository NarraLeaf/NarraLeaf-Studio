import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Follow one press to its end, and return what ends it early (`false`: nothing is kept).
 *
 * The moves and the release are read off the window, in the capture phase, rather than off the
 * element pressed: a drag that listened on the element alone stopped dead the moment the element
 * lost its pointer capture - which a drag here causes itself, because the stack's new order moves
 * elements in the page, and a moved element loses its capture - and then never ended, so the next
 * time the pointer merely passed over that element the old drag moved its layer again. The view's
 * root stops pointerup from bubbling, hence the capture phase.
 *
 * A move with the button no longer down ends the press as a release the window did not see (one
 * outside the window), and the window losing focus ends it with nothing kept.
 */
export function followPress(
    event: ReactPointerEvent,
    onMove: (move: PointerEvent) => void,
    onEnd: (released: boolean) => void,
): () => void {
    const pointerId = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture?.(pointerId);
    let ended = false;
    const finish = (released: boolean) => {
        if (ended) {
            return;
        }
        ended = true;
        window.removeEventListener("pointermove", handleMove, true);
        window.removeEventListener("pointerup", handleUp, true);
        window.removeEventListener("pointercancel", handleCancel, true);
        window.removeEventListener("blur", handleBlur);
        onEnd(released);
    };
    function handleMove(move: PointerEvent) {
        if (move.pointerId !== pointerId) {
            return;
        }
        if ((move.buttons & 1) === 0) {
            finish(true);
            return;
        }
        onMove(move);
    }
    function handleUp(up: PointerEvent) {
        if (up.pointerId === pointerId) {
            finish(true);
        }
    }
    function handleCancel(cancel: PointerEvent) {
        if (cancel.pointerId === pointerId) {
            finish(false);
        }
    }
    function handleBlur() {
        finish(false);
    }
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleCancel, true);
    window.addEventListener("blur", handleBlur);
    return () => finish(false);
}
