/**
 * Which pointer gesture a DOM event is, in the terms a binding is written in.
 *
 * Two places ask: every surface lane as an input reaches it (`GameSurfaceRenderer`), and the running
 * game itself for an input that reached no lane at all (`app/globalPointerInput`). They must agree -
 * a right click is `rightClick` whether it landed on a page or on nothing - so the table is written
 * once, here, over the primitives the two already share.
 *
 * Its own module rather than a function in `surfaceInputDom`, because it needs the touch recogniser
 * and the recogniser already imports that file.
 *
 * Comments in English per project convention.
 */

import type { UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";
import type { UIPointerInputDevice } from "./surfaceInputActions";
import { readPointerEventDevice, readWheelGesture } from "./surfaceInputDom";
import { isTouchStrokeInFlight, readTouchGestureDetail, UI_TOUCH_GESTURE_EVENT } from "./touchGesture";

/** One pointer input, as routing reads it. */
export type UIPointerInputGesture = {
    gesture: UIInputPointerGesture;
    device: UIPointerInputDevice;
    /**
     * The input is one the touch recogniser produced rather than one the browser raised.
     *
     * Two rules turn on it. A touch stroke has an explicit end, so it is not subject to the wheel
     * gate's silence window - running it through would let one stroke's claim swallow the next
     * stroke that happened to follow within a fifth of a second. And a stroke something answered has
     * to have its trailing synthetic click suppressed, which is only meaningful while the stroke is
     * the thing in hand: the tap-synthesised `click` that arrives afterwards is a touch input too,
     * and claiming on that one would eat the *following* tap.
     */
    fromTouchStroke?: boolean;
};

/**
 * The gesture this event is, or null when it is none.
 *
 * Null for the three events that look like one and are not: `auxclick` from any button but the
 * middle one (the secondary button has `contextmenu`, and would otherwise raise two), `contextmenu`
 * while a finger is on the glass (the platform's copy of a long press the recogniser answers
 * itself), and a wheel event whose deltas name no direction.
 */
export function readPointerInputGesture(event: Event): UIPointerInputGesture | null {
    switch (event.type) {
        case "click":
            // A tap synthesises a click and says so itself: see `readPointerEventDevice`.
            return { gesture: "click", device: readPointerEventDevice(event) };
        case "dblclick":
            return { gesture: "doubleClick", device: readPointerEventDevice(event) };
        case "auxclick":
            return (event as MouseEvent).button === 1
                ? { gesture: "middleClick", device: readPointerEventDevice(event) }
                : null;
        case "contextmenu":
            return isTouchStrokeInFlight() ? null : { gesture: "rightClick", device: readPointerEventDevice(event) };
        case "wheel": {
            // A `WheelEvent` names no device. A trackpad's two fingers are the trackpad's, so what
            // arrives here is always the mouse family.
            const gesture = readWheelGesture(event as WheelEvent);
            return gesture ? { gesture, device: "pointer" } : null;
        }
        case UI_TOUCH_GESTURE_EVENT: {
            const detail = readTouchGestureDetail(event);
            return detail ? { gesture: detail.gesture, device: "touch", fromTouchStroke: true } : null;
        }
        default:
            return null;
    }
}
