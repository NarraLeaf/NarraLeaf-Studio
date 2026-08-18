import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSkipRunController, type SkipRunControllerOptions } from "./skipRunController";

const SKIP_KEY = "Control";

function keyEvent(key: string, target: EventTarget | null = null): KeyboardEvent {
  return { key, target } as unknown as KeyboardEvent;
}

function makeController(overrides: Partial<SkipRunControllerOptions> = {}) {
  const skipOnce = vi.fn();
  const controller = createSkipRunController({
    matchesSkipKey: (key) => key === SKIP_KEY,
    canSkip: () => true,
    isBlocked: () => false,
    getSkipDelay: () => 0,
    getSkipInterval: () => 100,
    skipOnce,
    ...overrides
  });
  return { controller, skipOnce };
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
