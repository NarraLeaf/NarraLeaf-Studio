import { describe, expect, it } from "vitest";
import { createGestureDeadzone, GESTURE_DEADZONE_PX } from "./gestureDeadzone";

describe("createGestureDeadzone", () => {
  it("holds a gesture that has not travelled far enough", () => {
    const deadzone = createGestureDeadzone(4);
    deadzone.begin(100, 100);

    expect(deadzone.update(101, 100)).toBe(false);
    expect(deadzone.update(100, 102)).toBe(false);
    expect(deadzone.isArmed).toBe(false);
  });

  it("arms once the pointer reaches the threshold", () => {
    const deadzone = createGestureDeadzone(4);
    deadzone.begin(100, 100);

    expect(deadzone.update(104, 100)).toBe(true);
    expect(deadzone.isArmed).toBe(true);
  });

  it("measures travel as a distance, not per axis", () => {
    const deadzone = createGestureDeadzone(4);
    deadzone.begin(0, 0);

    // 2.83px away: within the deadzone even though both axes moved.
    expect(deadzone.update(2, 2)).toBe(false);
    // 4.24px away.
    expect(deadzone.update(3, 3)).toBe(true);
  });

  it("stays armed when the pointer comes back to where it started", () => {
    const deadzone = createGestureDeadzone(4);
    deadzone.begin(50, 50);
    deadzone.update(60, 50);

    expect(deadzone.update(50, 50)).toBe(true);
    expect(deadzone.isArmed).toBe(true);
  });

  it("disarms for the next gesture", () => {
    const deadzone = createGestureDeadzone(4);
    deadzone.begin(0, 0);
    deadzone.update(40, 40);

    deadzone.begin(200, 200);
    expect(deadzone.isArmed).toBe(false);
    expect(deadzone.update(201, 200)).toBe(false);
  });

  it("arms immediately when the gesture carries no usable pointer position", () => {
    const deadzone = createGestureDeadzone(4);
    deadzone.begin(Number.NaN, Number.NaN);

    expect(deadzone.isArmed).toBe(true);
    expect(deadzone.update(Number.NaN, Number.NaN)).toBe(true);
  });

  it("defaults to the shared threshold", () => {
    const deadzone = createGestureDeadzone();
    deadzone.begin(0, 0);

    expect(deadzone.update(GESTURE_DEADZONE_PX - 1, 0)).toBe(false);
    expect(deadzone.update(GESTURE_DEADZONE_PX, 0)).toBe(true);
  });
});
