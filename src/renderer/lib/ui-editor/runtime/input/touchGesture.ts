/**
 * What a finger on the glass means, in the same vocabulary a wheel and a mouse button already speak.
 *
 * A drag produces one of the four `wheel` directions and a held finger produces `longPress`, and
 * that is the whole list. No direction gesture of its own was added for touch: dragging a finger and
 * dragging two fingers on a trackpad are one gesture with one set of directions, so they share one
 * set of names and one convention for which way is which.
 *
 * ## Why Touch Events rather than Pointer Events
 *
 * Pointer Events would be the obvious base and are the wrong one. The moment a browser decides a
 * drag belongs to it - a list scrolling natively, the page rubber-banding - it raises
 * `pointercancel` and the pointer stream stops there; the touch stream carries on, only with
 * `cancelable` turned off. A panel whose "swipe down to dismiss" is meant to fire *after* the list
 * under the finger has scrolled to its end therefore cannot be built on pointers at all: the very
 * gesture it is waiting for is the one that ends the pointer stream. Built on touch, the recogniser
 * sees the whole stroke and the panel's own `overControls` decides what to do with it.
 *
 * ## Why the answer travels as a private CustomEvent
 *
 * Recognition happens on the window, because one stroke is one thing however many lanes it crosses.
 * The gesture it produces is then dispatched as a `CustomEvent` on the element the stroke started
 * on, and three things fall out of that:
 *
 *  - **It bubbles.** So the lane walk is the walk that already exists: `claimInputLaneVisit`,
 *    `stopsAtLane` and `handOffInputToLaneBehind` all apply unchanged.
 *  - **It can be cloned.** `CustomEvent` constructs on every target browser, where `TouchEvent`'s
 *    constructor has historically not on Safari - so handing the gesture to the lane behind is
 *    something this can actually do.
 *  - **It is not a `WheelEvent`.** An element's own `Mouse Wheel` head takes deltas from a wheel and
 *    is named after one; a finger dragging must not fire it. Synthesising a real wheel event would
 *    have lit every one of those heads on the way up.
 *
 * Comments in English per project convention.
 */

import type { UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";
import { getSharedInputHoldTracker } from "./inputHoldState";
import { readWheelGesture } from "./surfaceInputDom";

/**
 * How far a finger travels before the stroke is a drag rather than a tap, in **CSS pixels**.
 *
 * Not in the surface's design coordinates, and that is the point of saying so here: this is a
 * property of a fingertip on glass, so it must not change because an author drew their panel at
 * 1920 wide instead of 960.
 *
 * Bounded from below by the wobble inside a tap the player meant to be still - a fingertip's contact
 * patch is some 8-10 mm across and its centroid shifts by a few pixels as the finger presses and
 * lifts, which is why every platform's own tap slop sits around 8 px. Bounded from above by the
 * shortest deliberate flick, which is a movement of a centimetre or so - about 40 px on a phone.
 * Anything from roughly 8 to roughly 20 satisfies both; 12 sits low in that band because the two
 * failure modes are not worth the same. Too high loses a short deliberate flick, which the player
 * repeats harder and never understands; too low turns a wobbly tap into a scroll, which the same
 * player simply taps again.
 */
export const TOUCH_GESTURE_THRESHOLD_PX = 12;

/**
 * How long a finger stays still before it is a long press, in milliseconds.
 *
 * 500 is not a number chosen here - it is the number both platforms already chose. Android's
 * `ViewConfiguration.getLongPressTimeout()` has returned 500 ms since the first release, and UIKit's
 * `UILongPressGestureRecognizer` defaults `minimumPressDuration` to 0.5 s. So "take the platform's
 * answer" and "give both platforms the same answer" happen to be the same instruction, and there is
 * no trade-off to make between them.
 *
 * That coincidence is worth leaning on rather than merely noting. An author must not be able to feel
 * which phone a player is holding, and the way that is guaranteed here is by construction: one timer
 * of ours, in one piece of code, running on both. Deferring to each platform's own long-press
 * recogniser would have made the guarantee depend on two numbers staying equal - which they do
 * today, and which nothing keeps true tomorrow.
 */
export const UI_LONG_PRESS_MS = 500;

/**
 * The event name a recognised touch gesture travels under.
 *
 * Prefixed and private. Nothing outside this runtime should listen for it, and the prefix is what
 * keeps it from colliding with a name a host page or a plugin might reasonably use.
 */
export const UI_TOUCH_GESTURE_EVENT = "nl:touchgesture";

/** What one recognised touch gesture carries. */
export type UITouchGestureDetail = {
    gesture: UIInputPointerGesture;
    /**
     * Where the stroke went down, in client coordinates.
     *
     * The press point rather than where the finger has since travelled, because that is what the
     * rest of routing already means by where a gesture happened: the browser aims every event of a
     * stroke at the element the stroke started on, and `overControls` asks what the player put their
     * finger on. Reporting the current position would have the payload disagree with the hit chain
     * beside it.
     */
    clientX: number;
    clientY: number;
};

/** Whether this event is a recognised touch gesture, and what it says. */
export function readTouchGestureDetail(event: Event): UITouchGestureDetail | null {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== "object") {
        return null;
    }
    const candidate = detail as Partial<UITouchGestureDetail>;
    if (typeof candidate.gesture !== "string") {
        return null;
    }
    if (!Number.isFinite(candidate.clientX) || !Number.isFinite(candidate.clientY)) {
        return null;
    }
    return {
        gesture: candidate.gesture as UIInputPointerGesture,
        clientX: candidate.clientX as number,
        clientY: candidate.clientY as number,
    };
}

export type TouchStrokePoint = { clientX: number; clientY: number };

/**
 * One stroke's worth of state, with no DOM and no clock in it.
 *
 * Every rule that decides what a stroke means lives here, driven by coordinates and by two calls the
 * host makes when it decides the moment has come. That keeps the rules testable without spending
 * half a second of real time per long press, and keeps the DOM half down to plumbing.
 */
export type TouchStrokeRecognizer = {
    /** A finger landed and this is the only one on the glass. */
    begin(point: TouchStrokePoint): void;
    /** Fingers are on the glass but this stroke will produce nothing. */
    voidStroke(): void;
    /** The finger moved. Returns the gesture if this is the movement that crossed the threshold. */
    move(point: TouchStrokePoint): UITouchGestureDetail | null;
    /** The long-press deadline arrived. Returns the gesture if the stroke is still eligible. */
    holdElapsed(): UITouchGestureDetail | null;
    /** The last finger left. */
    end(): void;
    /** Something answered the gesture this stroke produced. */
    claim(): void;
    /** Whether fingers are on the glass right now. */
    inFlight(): boolean;
    /**
     * Whether the click the browser synthesises after this stroke must fire nothing, taking the
     * answer as it reads it so one suppressed click cannot suppress two.
     */
    takeClickSuppression(): boolean;
    reset(): void;
};

export function createTouchStrokeRecognizer(options?: { thresholdPx?: number }): TouchStrokeRecognizer {
    const thresholdPx = options?.thresholdPx ?? TOUCH_GESTURE_THRESHOLD_PX;
    /** Fingers are on the glass. */
    let active = false;
    /** This stroke will produce nothing, whatever it does next. */
    let voided = false;
    /**
     * This stroke has already produced its one gesture.
     *
     * The same rule the wheel gate states for a flick and its momentum tail, and it is here for the
     * same reason: a physical gesture is one thing, so it answers once. What touch does not need is
     * the wheel's silence threshold - a stroke has a `touchend` that says exactly when it ended.
     *
     * It is also what makes the race between the two recognisers first-past-the-post. Cross the
     * threshold before the deadline and the stroke is a drag, so the long press that would have
     * arrived later finds the gesture already spent; hold past the deadline and it is a press, and
     * no amount of dragging afterwards produces a direction.
     */
    let produced = false;
    let startX = 0;
    let startY = 0;
    let suppressClick = false;

    const gestureAt = (gesture: UIInputPointerGesture): UITouchGestureDetail => ({
        gesture,
        clientX: startX,
        clientY: startY,
    });

    return {
        begin(point) {
            if (active) {
                // A second finger. Multi-finger gestures belong to nobody here, and a stroke that
                // grew one is no longer the single-finger stroke it was being read as - so it stops
                // producing rather than carrying on with whichever finger the browser lists first.
                voided = true;
                return;
            }
            active = true;
            voided = false;
            produced = false;
            // A suppression nothing collected - a stroke whose synthetic click the browser never
            // sent - dies here rather than eating the next stroke's tap.
            suppressClick = false;
            startX = point.clientX;
            startY = point.clientY;
        },
        voidStroke() {
            active = true;
            voided = true;
            produced = false;
        },
        move(point) {
            if (!active || voided || produced) {
                return null;
            }
            const dx = point.clientX - startX;
            const dy = point.clientY - startY;
            if (Math.hypot(dx, dy) < thresholdPx) {
                return null;
            }
            // The direction convention is `readWheelGesture`'s, reached by handing it a delta rather
            // than by restating it: the finger going down carries the content down, which puts the
            // viewport up, which is `wheelUp`. Two spellings of that could drift apart; one cannot.
            const gesture = readWheelGesture({ deltaX: -dx, deltaY: -dy });
            if (!gesture) {
                return null;
            }
            produced = true;
            return gestureAt(gesture);
        },
        holdElapsed() {
            if (!active || voided || produced) {
                return null;
            }
            produced = true;
            return gestureAt("longPress");
        },
        end() {
            active = false;
            voided = false;
            // `produced` and `suppressClick` outlive the stroke on purpose: the click the browser
            // synthesises from a tap arrives after `touchend`, and is the thing being suppressed.
        },
        claim() {
            suppressClick = true;
        },
        inFlight: () => active,
        takeClickSuppression() {
            if (!suppressClick) {
                return false;
            }
            suppressClick = false;
            return true;
        },
        reset() {
            active = false;
            voided = false;
            produced = false;
            suppressClick = false;
        },
    };
}

/** The part of a `TouchEvent` this reads; a browser's carries far more. */
type TouchStrokeEvent = {
    target: EventTarget | null;
    touches: ArrayLike<TouchStrokePoint>;
    changedTouches: ArrayLike<TouchStrokePoint>;
};

/** The part of a `Window` this needs. */
export type UITouchGestureHost = {
    addEventListener(
        type: string,
        listener: (event: Event) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
        type: string,
        listener: (event: Event) => void,
        options?: boolean | EventListenerOptions,
    ): void;
    setTimeout(handler: () => void, timeout: number): unknown;
    clearTimeout(handle: unknown): void;
};

export type UITouchGestureTracker = {
    /** Whether the player's fingers are on the glass right now. */
    isTouchStrokeInFlight(): boolean;
    /** Something answered the gesture this stroke produced, so its synthetic click fires nothing. */
    claimStroke(): void;
    dispose(): void;
};

/**
 * A recogniser over one window, or over nothing.
 *
 * Every listener is in the capture phase, for the reason the hold tracker's are: what the player's
 * hand did is settled before any graph runs, and nothing an author's graph does on the way up
 * changes it. `touchmove` is registered passive - nothing here calls `preventDefault` on it, and
 * saying so lets the browser keep scrolling on its own thread.
 */
export function createTouchGestureTracker(
    host: UITouchGestureHost | null | undefined,
    options?: { thresholdPx?: number; longPressMs?: number },
): UITouchGestureTracker {
    const longPressMs = options?.longPressMs ?? UI_LONG_PRESS_MS;
    const recognizer = createTouchStrokeRecognizer({ thresholdPx: options?.thresholdPx });
    let strokeTarget: EventTarget | null = null;
    let holdTimer: unknown = null;

    const clearHoldTimer = (): void => {
        if (holdTimer !== null && host) {
            host.clearTimeout(holdTimer);
        }
        holdTimer = null;
    };

    const dispatch = (detail: UITouchGestureDetail): void => {
        // A long press is a state, not an instant: `Is Action Held` has to read it from the moment
        // it is recognised until the finger leaves, which is what makes "hold to hide the dialogue
        // and see the picture" a two-node graph. The tracker keeps only the gestures that are a
        // hold, so a direction gesture cannot become sticky by coming through here.
        getSharedInputHoldTracker().holdGesture(detail.gesture, strokeTarget);
        const target = strokeTarget;
        if (!target || typeof target.dispatchEvent !== "function") {
            return;
        }
        try {
            target.dispatchEvent(
                new CustomEvent<UITouchGestureDetail>(UI_TOUCH_GESTURE_EVENT, {
                    detail,
                    bubbles: true,
                    composed: true,
                    cancelable: true,
                }),
            );
        } catch {
            // A host with no CustomEvent constructor loses the gesture rather than throwing out of a
            // touch handler, which would take the rest of the stroke with it.
        }
    };

    const onTouchStart = (event: Event): void => {
        const touchEvent = event as unknown as TouchStrokeEvent;
        clearHoldTimer();
        const touch = touchEvent.changedTouches?.[0] ?? touchEvent.touches?.[0];
        if (!touch || (touchEvent.touches?.length ?? 0) > 1) {
            recognizer.voidStroke();
            strokeTarget = null;
            return;
        }
        recognizer.begin({ clientX: touch.clientX, clientY: touch.clientY });
        strokeTarget = touchEvent.target;
        if (host) {
            holdTimer = host.setTimeout(() => {
                holdTimer = null;
                const detail = recognizer.holdElapsed();
                if (detail) {
                    dispatch(detail);
                }
            }, longPressMs);
        }
    };

    const onTouchMove = (event: Event): void => {
        const touchEvent = event as unknown as TouchStrokeEvent;
        const touch = touchEvent.touches?.[0];
        if (!touch) {
            return;
        }
        const detail = recognizer.move({ clientX: touch.clientX, clientY: touch.clientY });
        if (!detail) {
            return;
        }
        // The finger is travelling, so it is not going to be a press however long it stays down.
        clearHoldTimer();
        dispatch(detail);
    };

    const onTouchEnd = (event: Event): void => {
        const touchEvent = event as unknown as TouchStrokeEvent;
        if ((touchEvent.touches?.length ?? 0) > 0) {
            // Other fingers are still down. The stroke ends when the glass is clear.
            return;
        }
        clearHoldTimer();
        recognizer.end();
        strokeTarget = null;
        getSharedInputHoldTracker().releaseGestures();
    };

    /**
     * The click a tap synthesises, after a stroke that already answered.
     *
     * Without this a drag that opens the log would advance the dialogue on the way out, because the
     * browser sends a `click` at the end of a touch stroke whatever else happened during it. Only a
     * stroke something actually fired an action from is suppressed - the same rule the wheel gate
     * keeps, where a gesture nobody answered is left entirely alone.
     */
    const onClickCapture = (event: Event): void => {
        if (!recognizer.takeClickSuppression()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    if (host) {
        host.addEventListener("touchstart", onTouchStart, true);
        host.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
        host.addEventListener("touchend", onTouchEnd, true);
        host.addEventListener("touchcancel", onTouchEnd, true);
        host.addEventListener("click", onClickCapture, true);
    }

    return {
        isTouchStrokeInFlight: () => recognizer.inFlight(),
        claimStroke: () => recognizer.claim(),
        dispose: () => {
            clearHoldTimer();
            recognizer.reset();
            strokeTarget = null;
            if (!host) {
                return;
            }
            host.removeEventListener("touchstart", onTouchStart, true);
            host.removeEventListener("touchmove", onTouchMove, true);
            host.removeEventListener("touchend", onTouchEnd, true);
            host.removeEventListener("touchcancel", onTouchEnd, true);
            host.removeEventListener("click", onClickCapture, true);
        },
    };
}

let sharedTracker: UITouchGestureTracker | null = null;

/**
 * The one recogniser, attached the first time anything asks for it.
 *
 * Lazily and never taken down on its own, for the reasons the hold tracker is. Callers arm it when
 * they mount rather than waiting for the first gesture to need it, because a recogniser built after
 * the finger has already landed has missed the `touchstart` that says where the stroke began.
 */
export function getSharedTouchGestureTracker(): UITouchGestureTracker {
    if (!sharedTracker) {
        sharedTracker = createTouchGestureTracker(typeof window === "undefined" ? null : window);
    }
    return sharedTracker;
}

/**
 * Whether a touch stroke is in flight right now.
 *
 * The question `contextmenu` is split on. Android raises that event from the platform's own held
 * finger and a mouse raises it from the right button, and the two must go different ways: the held
 * finger is already answered by the long press this file recognises, so the platform's version of it
 * is swallowed, and the right button stays `rightClick`. Asked of the recogniser rather than guessed
 * from `button` or `buttons`, both of which a synthesised context menu fills in as a mouse would.
 */
export function isTouchStrokeInFlight(): boolean {
    return getSharedTouchGestureTracker().isTouchStrokeInFlight();
}

/** Something answered this stroke's gesture, so the click it ends with fires nothing. */
export function claimTouchStroke(): void {
    getSharedTouchGestureTracker().claimStroke();
}

/** Drop the shared recogniser, so the next caller builds one over the window it can see. For tests. */
export function resetSharedTouchGestureTracker(): void {
    sharedTracker?.dispose();
    sharedTracker = null;
}
