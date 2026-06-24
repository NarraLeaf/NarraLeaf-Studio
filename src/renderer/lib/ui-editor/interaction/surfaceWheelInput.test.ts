import { describe, expect, it } from "vitest";
import {
    clampSurfaceWheelDelta,
    normalizeSurfaceWheelDelta,
    resolveSurfaceWheelPageDelta,
    SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX,
    SURFACE_WHEEL_PAN_DELTA_LIMIT_PX,
    SURFACE_WHEEL_ZOOM_DELTA_LIMIT_PX,
} from "./surfaceWheelInput";

describe("surface wheel input", () => {
    it("normalizes wheel delta modes to pixels", () => {
        expect(normalizeSurfaceWheelDelta(12, 0, 640)).toBe(12);
        expect(normalizeSurfaceWheelDelta(3, 1, 640)).toBe(48);
        expect(normalizeSurfaceWheelDelta(1, 2, 640)).toBe(640);
    });

    it("uses a fallback page delta when the surface size is unavailable", () => {
        expect(resolveSurfaceWheelPageDelta(0)).toBe(800);
        expect(resolveSurfaceWheelPageDelta(Number.NaN)).toBe(800);
        expect(normalizeSurfaceWheelDelta(1, 2, 0)).toBe(800);
    });

    it("clamps large touchpad deltas before canvas pan or zoom math", () => {
        expect(clampSurfaceWheelDelta(500, SURFACE_WHEEL_PAN_DELTA_LIMIT_PX)).toBe(96);
        expect(clampSurfaceWheelDelta(-500, SURFACE_WHEEL_ZOOM_DELTA_LIMIT_PX)).toBe(-80);
        expect(clampSurfaceWheelDelta(500, SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX)).toBe(24);
    });

    it("preserves small high-resolution touchpad deltas", () => {
        expect(clampSurfaceWheelDelta(7.5, SURFACE_PINCH_ZOOM_DELTA_LIMIT_PX)).toBe(7.5);
        expect(clampSurfaceWheelDelta(-11.25, SURFACE_WHEEL_PAN_DELTA_LIMIT_PX)).toBe(-11.25);
    });
});
