// @vitest-environment jsdom
/**
 * What a finger means, checked without spending a finger's worth of real time.
 *
 * The stroke rules are a pure state machine driven by coordinates and by two calls that stand in for
 * "the deadline arrived" and "the finger moved", so a long press costs nothing to test and a
 * threshold can be walked either side of exactly. The DOM half is checked separately, over fake
 * timers, because the only things left in it are which listener calls which rule.
 *
 * Comments in English per project convention.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createTouchGestureTracker,
    createTouchStrokeRecognizer,
    readTouchGestureDetail,
    TOUCH_GESTURE_THRESHOLD_PX,
    UI_LONG_PRESS_MS,
    UI_TOUCH_GESTURE_EVENT,
    type UITouchGestureDetail,
} from "./touchGesture";
import { getSharedInputHoldTracker, isInputBindingHeld, resetSharedInputHoldTracker } from "./inputHoldState";

/** Far enough past the threshold that no rounding decides the answer. */
const FAR = TOUCH_GESTURE_THRESHOLD_PX + 8;

/** The same, for a finger this stroke is not about. */
const PAST_THRESHOLD_OTHER = TOUCH_GESTURE_THRESHOLD_PX * 4;

function start(at: { x: number; y: number } = { x: 100, y: 100 }) {
    const recognizer = createTouchStrokeRecognizer();
    recognizer.begin({ clientX: at.x, clientY: at.y });
    return recognizer;
}

describe("one stroke's direction", () => {
    /**
     * The convention is the wheel's, and it is the one worth stating in a test rather than only in a
     * comment: the finger going *down* drags the content down with it, which moves the viewport
     * *up*, which is `wheelUp`. A reader who expects "down means down" has to be able to find this.
     */
    it("names the four directions the way a wheel names them", () => {
        expect(start().move({ clientX: 100, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
        expect(start().move({ clientX: 100, clientY: 100 - FAR })?.gesture).toBe("wheelDown");
        expect(start().move({ clientX: 100 + FAR, clientY: 100 })?.gesture).toBe("wheelLeft");
        expect(start().move({ clientX: 100 - FAR, clientY: 100 })?.gesture).toBe("wheelRight");
    });

    it("takes the larger axis where a finger moved on both", () => {
        // A finger never travels along one axis exactly, and an action bound to one direction firing
        // because the other axis was not quite zero is not a gesture anybody aimed.
        expect(start().move({ clientX: 100 + 4, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
        expect(start().move({ clientX: 100 + FAR, clientY: 100 + 4 })?.gesture).toBe("wheelLeft");
    });

    it("produces nothing inside the threshold", () => {
        const recognizer = start();

        // The wobble of a fingertip during a tap it meant to be still.
        expect(recognizer.move({ clientX: 104, clientY: 103 })).toBeNull();
        expect(recognizer.move({ clientX: 100, clientY: 108 })).toBeNull();

        // And it is still eligible for everything once the finger really travels.
        expect(recognizer.move({ clientX: 100, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
    });

    it("reports the point the stroke went down at, not where the finger has reached", () => {
        // The browser aims every event of a stroke at the element the first finger landed on, so the
        // payload has to agree with the hit chain beside it.
        expect(start({ x: 40, y: 60 }).move({ clientX: 40, clientY: 60 + FAR })).toEqual({
            gesture: "wheelUp",
            clientX: 40,
            clientY: 60,
        });
    });
});

describe("one stroke produces one gesture", () => {
    it("stops after the first direction, however far the finger carries on", () => {
        const recognizer = start();

        expect(recognizer.move({ clientX: 100, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
        expect(recognizer.move({ clientX: 100, clientY: 100 + FAR * 4 })).toBeNull();
        expect(recognizer.move({ clientX: 100, clientY: 100 - FAR * 4 })).toBeNull();
    });

    it("gives the long press to whichever recogniser reached its condition first", () => {
        const dragged = start();
        expect(dragged.move({ clientX: 100, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
        // The finger crossed the threshold before the deadline, so this is a drag and the long press
        // that would have arrived later finds the stroke already spent.
        expect(dragged.holdElapsed()).toBeNull();

        const held = start();
        expect(held.holdElapsed()?.gesture).toBe("longPress");
        // And the other way round: a press that won cannot be turned into a scroll by the finger
        // sliding afterwards, which is what a hand does while it holds something.
        expect(held.move({ clientX: 100, clientY: 100 + FAR * 4 })).toBeNull();
    });

    it("voids the stroke as soon as a second finger lands", () => {
        const recognizer = start();

        recognizer.begin({ clientX: 200, clientY: 200 });

        expect(recognizer.move({ clientX: 100, clientY: 100 + FAR })).toBeNull();
        expect(recognizer.holdElapsed()).toBeNull();
        // Fingers are still on the glass, which is what the `contextmenu` split asks about - a
        // voided stroke is not an absent one.
        expect(recognizer.inFlight()).toBe(true);
    });

    it("starts fresh on the next stroke", () => {
        const recognizer = start();
        expect(recognizer.move({ clientX: 100, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
        recognizer.end();
        expect(recognizer.inFlight()).toBe(false);

        recognizer.begin({ clientX: 100, clientY: 100 });
        expect(recognizer.move({ clientX: 100, clientY: 100 + FAR })?.gesture).toBe("wheelUp");
    });
});

describe("the click a stroke ends with", () => {
    it("is suppressed once, and only for a stroke something answered", () => {
        const answered = start();
        answered.move({ clientX: 100, clientY: 100 + FAR });
        answered.claim();
        answered.end();

        // Without this, a drag that opens the log advances the dialogue on its way out.
        expect(answered.takeClickSuppression()).toBe(true);
        // Taken rather than read: one suppressed click must not suppress two.
        expect(answered.takeClickSuppression()).toBe(false);

        const unanswered = start();
        unanswered.move({ clientX: 100, clientY: 100 + FAR });
        unanswered.end();
        expect(unanswered.takeClickSuppression()).toBe(false);
    });

    it("does not carry over to the next stroke when the browser sent no click", () => {
        const recognizer = start();
        recognizer.claim();
        recognizer.end();

        recognizer.begin({ clientX: 100, clientY: 100 });

        // A suppression nobody collected would otherwise eat the tap after it.
        expect(recognizer.takeClickSuppression()).toBe(false);
    });
});

describe("the recogniser over a window", () => {
    const trackers: Array<{ dispose: () => void }> = [];

    afterEach(() => {
        while (trackers.length) {
            trackers.pop()?.dispose();
        }
        resetSharedInputHoldTracker();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    function attach() {
        const tracker = createTouchGestureTracker(window);
        trackers.push(tracker);
        return tracker;
    }

    /**
     * A touch event as this reads one.
     *
     * Built by hand rather than with `TouchEvent`, whose constructor and `Touch` factory are not
     * available everywhere a test runs. Only `touches`, `changedTouches` and `target` are read.
     */
    function touch(
        node: EventTarget,
        type: string,
        touches: Array<{ clientX: number; clientY: number; identifier?: number }>,
        changed = touches,
    ): void {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "touches", { value: touches });
        Object.defineProperty(event, "changedTouches", { value: changed });
        node.dispatchEvent(event);
    }

    function listen(node: EventTarget): UITouchGestureDetail[] {
        const seen: UITouchGestureDetail[] = [];
        node.addEventListener(UI_TOUCH_GESTURE_EVENT, event => {
            const detail = readTouchGestureDetail(event);
            if (detail) {
                seen.push(detail);
            }
        });
        return seen;
    }

    function panel(): HTMLElement {
        const node = document.createElement("div");
        document.body.appendChild(node);
        return node;
    }

    it("dispatches the gesture on the element the stroke started on, and it bubbles", () => {
        attach();
        const node = panel();
        const seen = listen(document.body);

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        touch(node, "touchmove", [{ clientX: 100, clientY: 100 + FAR }]);

        expect(seen).toEqual([{ gesture: "wheelUp", clientX: 100, clientY: 100 }]);
    });

    it("produces a long press when the finger stays put for the whole timeout", () => {
        vi.useFakeTimers();
        attach();
        const node = panel();
        const seen = listen(document.body);

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        vi.advanceTimersByTime(UI_LONG_PRESS_MS - 1);
        expect(seen).toEqual([]);

        vi.advanceTimersByTime(1);
        expect(seen.map(entry => entry.gesture)).toEqual(["longPress"]);
    });

    it("cancels the long press the moment the finger starts travelling", () => {
        vi.useFakeTimers();
        attach();
        const node = panel();
        const seen = listen(document.body);

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        touch(node, "touchmove", [{ clientX: 100, clientY: 100 + FAR }]);
        vi.advanceTimersByTime(UI_LONG_PRESS_MS * 2);

        expect(seen.map(entry => entry.gesture)).toEqual(["wheelUp"]);
    });

    it("holds the long press until the finger leaves", () => {
        vi.useFakeTimers();
        attach();
        const node = panel();
        const hold = getSharedInputHoldTracker();
        const longPress = { kind: "pointer", gesture: "longPress" } as const;

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        vi.advanceTimersByTime(UI_LONG_PRESS_MS);
        expect(isInputBindingHeld(longPress, hold.read())).toBe(true);
        expect(hold.readPressTarget("longPress")).toBe(node);

        touch(node, "touchend", [], [{ clientX: 100, clientY: 100 }]);
        expect(isInputBindingHeld(longPress, hold.read())).toBe(false);
    });

    it("lets go of a held gesture the browser takes away", () => {
        vi.useFakeTimers();
        attach();
        const node = panel();
        const hold = getSharedInputHoldTracker();

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        vi.advanceTimersByTime(UI_LONG_PRESS_MS);
        touch(node, "touchcancel", [], [{ clientX: 100, clientY: 100 }]);

        expect(hold.read().gestures.size).toBe(0);
    });

    it("swallows the click a stroke it answered ends with", () => {
        const tracker = attach();
        const node = panel();
        const clicked = vi.fn();
        node.addEventListener("click", clicked);

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        touch(node, "touchmove", [{ clientX: 100, clientY: 100 + FAR }]);
        tracker.claimStroke();
        touch(node, "touchend", [], [{ clientX: 100, clientY: 100 + FAR }]);
        node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

        expect(clicked).not.toHaveBeenCalled();

        // The next tap is nobody's business but its own.
        node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(clicked).toHaveBeenCalledTimes(1);
    });

    it("produces nothing from a two-finger stroke, and still calls it in flight", () => {
        vi.useFakeTimers();
        const tracker = attach();
        const node = panel();
        const seen = listen(document.body);

        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }]);
        touch(node, "touchstart", [{ clientX: 100, clientY: 100 }, { clientX: 200, clientY: 200 }], [
            { clientX: 200, clientY: 200 },
        ]);
        touch(node, "touchmove", [{ clientX: 100, clientY: 100 + FAR }, { clientX: 200, clientY: 200 }]);
        vi.advanceTimersByTime(UI_LONG_PRESS_MS * 2);

        expect(seen).toEqual([]);
        // The `contextmenu` split asks whether fingers are on the glass, not whether this stroke is
        // still going to mean anything.
        expect(tracker.isTouchStrokeInFlight()).toBe(true);

        touch(node, "touchend", [], [{ clientX: 100, clientY: 100 }]);
        expect(tracker.isTouchStrokeInFlight()).toBe(false);
    });

    it("follows the finger it started on rather than whichever is listed first", () => {
        attach();
        const node = panel();
        const seen = listen(document.body);

        // A stroke that began on finger 7, with an unrelated finger arriving ahead of it in the
        // list. Reading index zero would measure the wrong hand's travel - which on a phone looks
        // like a gesture firing from a movement the player did not make with that finger.
        touch(node, "touchstart", [{ clientX: 100, clientY: 100, identifier: 7 }]);
        touch(node, "touchmove", [
            { clientX: 100, clientY: 100 + PAST_THRESHOLD_OTHER, identifier: 3 },
            { clientX: 100, clientY: 100, identifier: 7 },
        ]);
        expect(seen).toEqual([]);

        touch(node, "touchmove", [
            { clientX: 100, clientY: 100, identifier: 3 },
            { clientX: 100, clientY: 100 + FAR, identifier: 7 },
        ]);
        expect(seen.map(entry => entry.gesture)).toEqual(["wheelUp"]);
    });

    it("reads nothing where there is no window to listen to", () => {
        const tracker = createTouchGestureTracker(null);
        expect(tracker.isTouchStrokeInFlight()).toBe(false);
        tracker.claimStroke();
        tracker.dispose();
    });
});

describe("readTouchGestureDetail", () => {
    it("refuses anything that is not one of ours", () => {
        expect(readTouchGestureDetail(new CustomEvent(UI_TOUCH_GESTURE_EVENT))).toBeNull();
        expect(readTouchGestureDetail(new CustomEvent(UI_TOUCH_GESTURE_EVENT, { detail: { gesture: "click" } }))).toBeNull();
        expect(readTouchGestureDetail(new MouseEvent("click"))).toBeNull();
    });
});
