/**
 * One wheel gesture counts once.
 *
 * A wheel is not a button. A single physical flick on a precision trackpad produces one burst of
 * events while the fingers move and then a momentum tail that keeps producing them for another half
 * second to a second and a half after the fingers have left the surface. Nothing in a `wheel` event
 * says which of those it is: the tail is spelled exactly like the flick.
 *
 * That is a problem the moment a wheel gesture *navigates*. Flicking up on the dialogue opens the
 * backlog; the backlog answers the wheel too; and the tail of the very same flick fires the
 * backlog's action, so the page opens and shuts in one motion. Measured on a real machine.
 *
 * ## Why this is not a transition guard
 *
 * The obvious fix - "ignore input while the page is arriving" - does not work, and it is worth
 * writing down why so nobody rebuilds it. The default page preset is `enter: "none"`, whose
 * entering window is a single prepaint frame (2-38 ms measured); even a fade is about 290 ms,
 * shorter than a tail. Stage-slot surfaces never report a transition state at all, so the question
 * reads `false` there permanently. And a timer an author has to know about is a timer an author
 * will forget on the next page they build.
 *
 * ## The rule
 *
 * `consume` is extended from "this event" to "this physical gesture". When a pointer action
 * consumes a wheel event, the rest of that gesture fires nothing anywhere - no surface action, no
 * element wheel head, on any lane. The gesture ends after a silence, and that threshold is a
 * property of how wheel events are delivered rather than of anything we draw, which is why it is
 * the only new constant and why no author ever sees it.
 *
 * Kept pure and away from React: the whole rule is "when did the last wheel event arrive and has
 * something claimed this gesture", and a test can drive that with numbers.
 *
 * Comments in English per project convention.
 */

import { UI_INPUT_POINTER_GESTURES, type UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";

/**
 * How long a wheel stream must go quiet before the next event is a new gesture, in milliseconds.
 *
 * Bounded from below by the largest gap that can occur *inside* one live gesture. Wheel events are
 * delivered at the compositor's cadence - about 8 ms at 120 Hz, 17 ms at 60 Hz, 33 ms at 30 Hz -
 * and the browser coalesces the ones that pile up behind a stalled frame into a single later
 * delivery, so a hitch shows up as one gap as long as the hitch. The hitch this has to survive is a
 * page opening, which is the most expensive frame in the whole sequence; 180 ms is roughly eleven
 * frames at 60 Hz and leaves room for a stall an order of magnitude longer than a good one.
 *
 * Bounded from above by the smallest gap between two flicks a player means as two. Ending a gesture
 * means the fingers leaving the surface and starting the next means putting them back and moving
 * again, which even at a determined scrolling cadence is roughly four per second - 250 ms apart.
 *
 * Anything from about 100 to about 200 satisfies both. 180 sits near the top of that band because
 * the two failure modes are not worth the same: too short brings back a page that opens and shuts
 * on one flick, while too long loses an unusually fast second flick that the player simply repeats.
 * It also costs almost nothing to be generous here, because the gate only engages once something
 * has consumed - ordinary scrolling, including a list's own native scrolling, never meets it.
 */
export const WHEEL_GESTURE_SILENCE_MS = 180;

const WHEEL_GESTURES: ReadonlySet<string> = new Set(
    UI_INPUT_POINTER_GESTURES.filter(gesture => gesture.startsWith("wheel")),
);

/** Whether this gesture is one a wheel produces, and so one that belongs to a gesture stream. */
export function isWheelPointerGesture(gesture: UIInputPointerGesture): boolean {
    return WHEEL_GESTURES.has(gesture);
}

export type WheelGestureGate = {
    /**
     * Whether this wheel event may fire anything, counting it as part of the current gesture.
     *
     * Every wheel event must come through here, including the ones this refuses: the tail is what
     * keeps the gesture alive, and a swallowed event that did not extend the silence window would
     * let the gesture "end" in the middle of itself.
     *
     * One physical event gets one verdict however many times it is asked - an element head asks on
     * the way up and the surface shell asks after it, and a lane behind asks again on the copy it
     * is handed. The answer is remembered against the event object so the two cannot disagree.
     */
    admit(event: object, now: number): boolean;
    /**
     * The rest of this event's gesture fires nothing.
     *
     * Called by whatever consumed the event, after it has consumed it. The event in hand keeps the
     * verdict it was already given, so the consuming event still counts; everything after it in the
     * same gesture does not.
     */
    claim(now: number): void;
    /** Forget the gesture in flight. For tests and for a runtime being torn down. */
    reset(): void;
};

export function createWheelGestureGate(options?: { silenceMs?: number }): WheelGestureGate {
    const silenceMs = options?.silenceMs ?? WHEEL_GESTURE_SILENCE_MS;
    /**
     * The verdict already given to an event object.
     *
     * Weak because the key is a DOM event nobody else keeps, in the same shape and for the same
     * reason as the lane visit record in `surfaceInputDom`.
     */
    const verdicts = new WeakMap<object, boolean>();
    let lastEventAt: number | null = null;
    let claimed = false;

    return {
        admit(event, now) {
            const remembered = verdicts.get(event);
            if (remembered !== undefined) {
                return remembered;
            }
            if (lastEventAt === null || now - lastEventAt > silenceMs) {
                // The stream went quiet for long enough that the fingers left the trackpad. Whatever
                // claimed the last gesture has no say over this one.
                claimed = false;
            }
            lastEventAt = now;
            const admitted = !claimed;
            verdicts.set(event, admitted);
            return admitted;
        },
        claim(now) {
            claimed = true;
            lastEventAt = now;
        },
        reset() {
            lastEventAt = null;
            claimed = false;
        },
    };
}

/**
 * The gate the running game uses.
 *
 * One per renderer, not one per surface or per lane: a physical flick is one thing however many
 * lanes it crosses, and "the rest of that gesture fires nothing *anywhere*" is only true of a gate
 * that every lane shares.
 */
export const wheelGestureGate = createWheelGestureGate();

/**
 * When an input event happened, on the clock the gate compares against.
 *
 * `timeStamp` is preferred because it is when the browser made the event rather than when a handler
 * got round to it, which is the difference that matters when a frame stalls; it is a
 * `DOMHighResTimeStamp` on the same origin as `performance.now()`, so the two can be mixed. The
 * fallbacks are for hosts and test doubles that leave it at zero.
 */
export function readInputEventTime(event: { timeStamp?: number } | null | undefined): number {
    const stamp = event?.timeStamp;
    if (typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0) {
        return stamp;
    }
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}
