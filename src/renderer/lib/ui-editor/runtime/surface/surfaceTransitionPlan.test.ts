import { describe, expect, it } from "vitest";
import { shouldHoldCurrentSurfaceUntilEnterComplete } from "./surfaceTransitionPlan";

describe("surface transition plan", () => {
    it("keeps the current surface mounted until the incoming enter animation finishes when exit is instant", () => {
        expect(shouldHoldCurrentSurfaceUntilEnterComplete({
            waitForExit: false,
            hasCurrentSurface: true,
            exitDurationMs: 0,
            enterDurationMs: 260,
        })).toBe(true);
    });

    it("does not hold the current surface for blocking exits, animated exits, hidden surfaces, or instant enters", () => {
        expect(shouldHoldCurrentSurfaceUntilEnterComplete({
            waitForExit: true,
            hasCurrentSurface: true,
            exitDurationMs: 0,
            enterDurationMs: 260,
        })).toBe(false);

        expect(shouldHoldCurrentSurfaceUntilEnterComplete({
            waitForExit: false,
            hasCurrentSurface: true,
            exitDurationMs: 160,
            enterDurationMs: 260,
        })).toBe(false);

        expect(shouldHoldCurrentSurfaceUntilEnterComplete({
            waitForExit: false,
            hasCurrentSurface: true,
            exitDurationMs: 0,
            enterDurationMs: 0,
        })).toBe(false);

        expect(shouldHoldCurrentSurfaceUntilEnterComplete({
            waitForExit: false,
            hasCurrentSurface: true,
            exitDurationMs: 0,
            enterDurationMs: 260,
            outgoingHidden: true,
        })).toBe(false);
    });
});
