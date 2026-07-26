import { describe, expect, it } from "vitest";
import { DEFAULT_OPAQUE_BACKGROUND, findProjectIconOutput } from "@shared/types/projectIcons";
import {
    MIN_ICON_SOURCE_EDGE,
    halvingSteps,
    iconSourceIsLowResolution,
    planIconDraw,
} from "./iconRecipe";

const spec = (overrides: Partial<{ inset: number; background: string | null }> = {}) => ({
    override: null,
    inset: 0,
    background: null,
    ...overrides,
});

describe("planIconDraw", () => {
    const windows = findProjectIconOutput("windows");

    it("fills the canvas when a square source has no inset", () => {
        const plan = planIconDraw({ sourceWidth: 512, sourceHeight: 512, spec: spec(), output: windows });
        expect(plan).toMatchObject({ canvas: 1024, x: 0, y: 0, width: 1024, height: 1024 });
    });

    it("insets from every edge and stays centred", () => {
        const plan = planIconDraw({ sourceWidth: 512, sourceHeight: 512, spec: spec({ inset: 0.1 }), output: windows });
        expect(plan.width).toBeCloseTo(1024 * 0.8);
        expect(plan.x).toBeCloseTo(1024 * 0.1);
        expect(plan.x).toBeCloseTo(plan.canvas - plan.x - plan.width);
    });

    it("preserves aspect on a non-square source instead of stretching it", () => {
        const plan = planIconDraw({ sourceWidth: 1000, sourceHeight: 500, spec: spec(), output: windows });
        expect(plan.width).toBe(1024);
        expect(plan.height).toBe(512);
        expect(plan.width / plan.height).toBeCloseTo(2);
        expect(plan.y).toBeCloseTo(256);
        expect(plan.x).toBe(0);
    });

    it("fits a tall source by its long edge", () => {
        const plan = planIconDraw({ sourceWidth: 300, sourceHeight: 900, spec: spec(), output: windows });
        expect(plan.height).toBe(1024);
        expect(plan.width).toBeCloseTo(1024 / 3);
    });

    it("treats an unreadable source size as square", () => {
        const plan = planIconDraw({ sourceWidth: 0, sourceHeight: 0, spec: spec(), output: windows });
        expect(plan.width).toBe(1024);
        expect(plan.height).toBe(1024);
    });

    it("never lets an inset collapse the artwork to nothing", () => {
        const plan = planIconDraw({ sourceWidth: 512, sourceHeight: 512, spec: spec({ inset: 5 }), output: windows });
        expect(plan.width).toBeGreaterThan(0);
    });

    it("forces a background on an output that forbids alpha", () => {
        expect(planIconDraw({ sourceWidth: 1, sourceHeight: 1, spec: spec(), output: findProjectIconOutput("ios") }).background)
            .toBe(DEFAULT_OPAQUE_BACKGROUND);
        expect(planIconDraw({ sourceWidth: 1, sourceHeight: 1, spec: spec(), output: windows }).background)
            .toBeNull();
    });

    it("sizes the canvas from the output, not the source", () => {
        expect(planIconDraw({ sourceWidth: 4096, sourceHeight: 4096, spec: spec(), output: findProjectIconOutput("web-favicon") }).canvas)
            .toBe(32);
    });
});

describe("iconSourceIsLowResolution", () => {
    it("passes a source at or above the packager's floor", () => {
        expect(iconSourceIsLowResolution(MIN_ICON_SOURCE_EDGE, MIN_ICON_SOURCE_EDGE)).toBe(false);
        expect(iconSourceIsLowResolution(1024, 1024)).toBe(false);
    });

    it("flags a source that has to be upscaled, or one whose size is unknown", () => {
        expect(iconSourceIsLowResolution(256, 256)).toBe(true);
        expect(iconSourceIsLowResolution(0, 0)).toBe(true);
    });

    it("judges by the long edge, since that is what fills the canvas", () => {
        expect(iconSourceIsLowResolution(1024, 100)).toBe(false);
    });
});

describe("halvingSteps", () => {
    it("walks a large downscale down in halves", () => {
        expect(halvingSteps(1024, 32)).toEqual([512, 256, 128, 64]);
    });

    it("returns nothing when one step is already close enough", () => {
        expect(halvingSteps(1024, 512)).toEqual([]);
        expect(halvingSteps(1024, 600)).toEqual([]);
    });

    it("returns nothing when the target is larger than the source", () => {
        expect(halvingSteps(256, 1024)).toEqual([]);
    });
});
