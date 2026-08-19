import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkipRunController, type SkipRunControllerOptions } from "./skipRunController";

const SKIP_KEY = "Control";

function keyEvent(key: string, target: EventTarget | null = null): KeyboardEvent {
    return { key, target } as unknown as KeyboardEvent;
}

function makeController(overrides: Partial<SkipRunControllerOptions> = {}) {
    const skipOnce = vi.fn();
    // The host answers this by writing `false` into the preference, which comes straight back as
    // `setSkipping(false)`. Modelling that here is the point: without it the controller and the
    // value it is driven from would be tested apart, and it is their disagreement that shows up on
    // screen as a Skip button lit over a game that stopped skipping.
    const onSkippingEnded = vi.fn(() => controller.setSkipping(false));
    const controller = createSkipRunController({
        matchesSkipKey: key => key === SKIP_KEY,
        canSkip: () => true,
        isBlocked: () => false,
        getSkipDelay: () => 0,
        getSkipInterval: () => 100,
        skipOnce,
        onSkippingEnded,
        ...overrides,
    });
    return { controller, skipOnce, onSkippingEnded };
}

describe("createSkipRunController", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("skips once immediately, then on the interval", () => {
        const { controller, skipOnce } = makeController();
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        expect(skipOnce).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(300);
        expect(skipOnce).toHaveBeenCalledTimes(4);
        controller.handleKeyUp(keyEvent(SKIP_KEY));
        vi.advanceTimersByTime(300);
        expect(skipOnce).toHaveBeenCalledTimes(4);
    });

    it("waits out the skip delay before running continuously", () => {
        const { controller, skipOnce } = makeController({ getSkipDelay: () => 500 });
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        expect(skipOnce).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(400);
        // Still the single press-step: the hold has not earned continuous skipping yet.
        expect(skipOnce).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(200);
        expect(skipOnce).toHaveBeenCalledTimes(2);
    });

    it("ignores keys that are not bound to skipping", () => {
        const { controller, skipOnce } = makeController();
        controller.handleKeyDown(keyEvent("a"));
        vi.advanceTimersByTime(300);
        expect(skipOnce).not.toHaveBeenCalled();
    });

    it("ignores the key while the player is typing into a field", () => {
        const { controller, skipOnce } = makeController({ isTextEntryTarget: () => true });
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        expect(skipOnce).not.toHaveBeenCalled();
    });

    it("does nothing at all when skipping is not allowed", () => {
        const { controller, skipOnce } = makeController({ canSkip: () => false });
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        vi.advanceTimersByTime(300);
        expect(skipOnce).not.toHaveBeenCalled();
    });

    // OS auto-repeat delivers a keydown per repeat; a run must not restart on those, or the latch
    // below would be defeated by the platform.
    it("treats repeated keydowns during a hold as one press", () => {
        const { controller, skipOnce } = makeController();
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        expect(skipOnce).toHaveBeenCalledTimes(1);
    });

    describe("the unread-text guard", () => {
        it("refuses to start on a line the player has not read", () => {
            const { controller, skipOnce } = makeController({ isBlocked: () => true });
            controller.handleKeyDown(keyEvent(SKIP_KEY));
            vi.advanceTimersByTime(300);
            expect(skipOnce).not.toHaveBeenCalled();
            expect(controller.isRunning()).toBe(false);
        });

        it("stops a run in flight the moment it reaches one", () => {
            let blocked = false;
            const { controller, skipOnce } = makeController({ isBlocked: () => blocked });
            controller.handleKeyDown(keyEvent(SKIP_KEY));
            vi.advanceTimersByTime(200);
            expect(skipOnce).toHaveBeenCalledTimes(3);
            blocked = true;
            vi.advanceTimersByTime(500);
            expect(skipOnce).toHaveBeenCalledTimes(3);
            expect(controller.isRunning()).toBe(false);
        });

        // The latch. A line becomes "read" the moment it finishes typing, a beat after the run
        // stopped for it - so a guard that only gated each step would let a still-held key resume
        // and skip straight past the very text it stopped for.
        it("stays stopped for the rest of the hold even after the line becomes read", () => {
            let blocked = false;
            const { controller, skipOnce } = makeController({ isBlocked: () => blocked });
            controller.handleKeyDown(keyEvent(SKIP_KEY));
            blocked = true;
            vi.advanceTimersByTime(200);
            const stoppedAt = skipOnce.mock.calls.length;

            blocked = false;
            // Auto-repeat keeps arriving while the key is down.
            controller.handleKeyDown(keyEvent(SKIP_KEY));
            vi.advanceTimersByTime(500);
            expect(skipOnce).toHaveBeenCalledTimes(stoppedAt);

            // Released and pressed again: the player has decided to skip on.
            controller.handleKeyUp(keyEvent(SKIP_KEY));
            controller.handleKeyDown(keyEvent(SKIP_KEY));
            expect(skipOnce).toHaveBeenCalledTimes(stoppedAt + 1);
        });
    });

    it("floors an absurd interval so the run cannot starve the renderer", () => {
        const { controller, skipOnce } = makeController({ getSkipInterval: () => 1 });
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        vi.advanceTimersByTime(80);
        // 8ms floor: ten steps, not eighty.
        expect(skipOnce).toHaveBeenCalledTimes(11);
    });

    describe("the mode", () => {
        it("runs exactly as a held key does", () => {
            const { controller, skipOnce } = makeController();
            controller.setSkipping(true);
            expect(skipOnce).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(300);
            expect(skipOnce).toHaveBeenCalledTimes(4);
        });

        it("keeps running when nobody is holding a key, and stops when it is turned off", () => {
            const { controller, skipOnce } = makeController();
            controller.setSkipping(true);
            vi.advanceTimersByTime(300);
            controller.setSkipping(false);
            const stoppedAt = skipOnce.mock.calls.length;
            vi.advanceTimersByTime(500);
            expect(skipOnce).toHaveBeenCalledTimes(stoppedAt);
            expect(controller.isRunning()).toBe(false);
        });

        // Two loops on one story would skip two lines an interval and clear each other's timers.
        it("shares one run with the key rather than starting a second", () => {
            const { controller, skipOnce } = makeController();
            controller.setSkipping(true);
            expect(skipOnce).toHaveBeenCalledTimes(1);
            // Joining the run: no extra step, and no second interval.
            controller.handleKeyDown(keyEvent(SKIP_KEY));
            expect(skipOnce).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(300);
            expect(skipOnce).toHaveBeenCalledTimes(4);
            // Releasing leaves the mode running - the player pressed a key over a run they did not
            // start.
            controller.handleKeyUp(keyEvent(SKIP_KEY));
            vi.advanceTimersByTime(300);
            expect(skipOnce).toHaveBeenCalledTimes(7);
            expect(controller.isSkipping()).toBe(true);
        });

        it("refuses to start when skipping is not allowed, and says so", () => {
            const { controller, skipOnce, onSkippingEnded } = makeController({ canSkip: () => false });
            controller.setSkipping(true);
            vi.advanceTimersByTime(300);
            expect(skipOnce).not.toHaveBeenCalled();
            expect(onSkippingEnded).toHaveBeenCalledTimes(1);
            expect(controller.isSkipping()).toBe(false);
        });

        // The equivalent of letting go: there is no key to release, so the controller releases the
        // value instead.
        it("turns itself off when the guard stops the run", () => {
            let blocked = false;
            const { controller, skipOnce, onSkippingEnded } = makeController({ isBlocked: () => blocked });
            controller.setSkipping(true);
            vi.advanceTimersByTime(200);
            expect(skipOnce).toHaveBeenCalledTimes(3);
            blocked = true;
            vi.advanceTimersByTime(500);
            expect(skipOnce).toHaveBeenCalledTimes(3);
            expect(onSkippingEnded).toHaveBeenCalledTimes(1);
            expect(controller.isSkipping()).toBe(false);
            expect(controller.isRunning()).toBe(false);
        });

        // Turning skipping on and then opening a settings screen: the run has no key to release
        // and would otherwise advance the story behind the menu.
        it("stops when the story leaves the screen", () => {
            let allowed = true;
            const { controller, skipOnce, onSkippingEnded } = makeController({ canSkip: () => allowed });
            controller.setSkipping(true);
            vi.advanceTimersByTime(200);
            expect(skipOnce).toHaveBeenCalledTimes(3);
            allowed = false;
            vi.advanceTimersByTime(500);
            expect(skipOnce).toHaveBeenCalledTimes(3);
            expect(onSkippingEnded).toHaveBeenCalledTimes(1);
            expect(controller.isSkipping()).toBe(false);
        });

        it("turns itself off when the stage goes away or the window loses focus", () => {
            const { controller, onSkippingEnded } = makeController();
            controller.setSkipping(true);
            controller.stop();
            expect(onSkippingEnded).toHaveBeenCalledTimes(1);
            expect(controller.isSkipping()).toBe(false);
            expect(controller.isRunning()).toBe(false);
        });

        // The host drives this from a change event it also causes, so the same value arriving twice
        // has to cost nothing.
        it("ignores a value it is already at", () => {
            const { controller, skipOnce, onSkippingEnded } = makeController();
            controller.setSkipping(true);
            controller.setSkipping(true);
            expect(skipOnce).toHaveBeenCalledTimes(1);
            controller.setSkipping(false);
            controller.setSkipping(false);
            expect(onSkippingEnded).not.toHaveBeenCalled();
        });
    });

    it("stops on demand, e.g. when the window loses focus mid-hold", () => {
        const { controller, skipOnce } = makeController();
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        controller.stop();
        vi.advanceTimersByTime(500);
        expect(skipOnce).toHaveBeenCalledTimes(1);
        // And the key counts as released, so coming back and pressing it works.
        controller.handleKeyDown(keyEvent(SKIP_KEY));
        expect(skipOnce).toHaveBeenCalledTimes(2);
    });
});
