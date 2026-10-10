/**
 * A pointer input that reached no lane, offered to the game's global blueprint.
 *
 * A pointer gesture normally reaches the global blueprint at the first surface lane it lands on
 * (`GameSurfaceRenderer`). Some land on none. A page's container is click-through wherever it has no
 * content, so a right click on an empty part of the title screen goes past the page to the stage
 * behind it - and before a story starts there is nothing on the stage to take it, and while one
 * plays a hidden dialogue box takes nothing either. For a page that is the rule it has always had:
 * what a page answers is input that landed on it. The global blueprint is not a page. It belongs to
 * the game, and "right click opens the menu" written on it means anywhere in the game - so an input
 * the game received and no lane took is still the global blueprint's.
 *
 * The game's own drawing root listens for what bubbles up to it, which is exactly the input no lane
 * took: a lane that answers an input stops it, and one that passes it hands it on and has already
 * given the global its turn. The same gesture table, the same control rule and the same wheel and
 * touch bookkeeping as a lane, so the global hears a gesture the same way whether or not something
 * was drawn under the pointer.
 *
 * Comments in English per project convention.
 */

import type { UIDocument } from "@shared/types/ui-editor/document";
import { getOrCreateDomEventPropagationControl } from "@/lib/ui-editor/runtime/eventPropagationControl";
import type { GlobalInputActionAnswerer } from "@/lib/ui-editor/runtime/input/globalInputActionContext";
import { readPointerInputGesture } from "@/lib/ui-editor/runtime/input/pointerInputGesture";
import { resolveGlobalInputActionPayloads } from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import { readInputEventPoint, readSurfaceHitNodes, takeGlobalInputTurn } from "@/lib/ui-editor/runtime/input/surfaceInputDom";
import { claimTouchStroke } from "@/lib/ui-editor/runtime/input/touchGesture";
import { isWheelPointerGesture, readInputEventTime, wheelGestureGate } from "@/lib/ui-editor/runtime/input/wheelGesture";

/**
 * The attribute that marks what a runtime plugin draws over the stage.
 *
 * A plugin's overlay is drawn by the host inside the game's root, and what a player clicks there is
 * the plugin's control - the same as a button on a page, which a panel-wide action stands down over.
 * So an input from inside it is not offered to the global blueprint.
 */
export const RUNTIME_PLUGIN_OVERLAY_ATTR = "data-nl-runtime-plugin-overlays";

export type UnclaimedPointerInput = {
    /** The native event, as it arrived at the game's root. */
    event: Event;
    /** The game's drawing root: the stage, the plugin overlays and every surface are inside it. */
    root: Element;
    /** The interface document, for the elements under the pointer. */
    document: UIDocument;
    /** The scale the surfaces are drawn at: screen pixels per design pixel. */
    scale: number;
    answer: GlobalInputActionAnswerer;
};

/**
 * Offer one input that bubbled to the game's root to the global blueprint, if no lane has.
 *
 * Returns whether the global answered it.
 */
export function offerUnclaimedPointerInput(input: UnclaimedPointerInput): boolean {
    const { event, root, document } = input;
    const target = event.target;
    if (target instanceof Element && target.closest(`[${RUNTIME_PLUGIN_OVERLAY_ATTR}]`)) {
        return false;
    }
    const gesture = readPointerInputGesture(event);
    const time = readInputEventTime(event);
    if (!gesture) {
        if (event.type === "wheel") {
            // Still part of the gesture in flight, as it is on a lane: see `handleSurfaceWheel`.
            wheelGestureGate.admit(event, time);
        }
        return false;
    }
    // A lane that took the input gave the global its turn already, or refused the tail of a
    // gesture something answered - and stopped it there, so neither arrives here to be asked twice.
    if (!takeGlobalInputTurn(event)) {
        return false;
    }
    const wheel = isWheelPointerGesture(gesture.gesture) && !gesture.fromTouchStroke;
    if (wheel && !wheelGestureGate.admit(event, time)) {
        return false;
    }
    const point = readInputEventPoint(event);
    const rect = root.getBoundingClientRect();
    const scale = Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1;
    const payloads = resolveGlobalInputActionPayloads({
        vocabulary: document.actions,
        signal: {
            kind: "pointer",
            gesture: gesture.gesture,
            device: gesture.device,
            x: point ? (point.clientX - rect.left) / scale : 0,
            y: point ? (point.clientY - rect.top) / scale : 0,
        },
        hitChain: readSurfaceHitNodes({ document, target, surfaceRoot: root, gesture: gesture.gesture }),
    });
    if (payloads.length === 0) {
        return false;
    }
    void input.answer(payloads, getOrCreateDomEventPropagationControl(event));
    // Spent, as it is when a lane's action consumes it: the tail of the scroll and the click a
    // finger leaves behind fire nothing.
    if (wheel) {
        wheelGestureGate.claim(time);
    }
    if (gesture.fromTouchStroke) {
        claimTouchStroke();
    }
    return true;
}
