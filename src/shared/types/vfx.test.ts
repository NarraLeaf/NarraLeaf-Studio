import { describe, expect, it } from "vitest";
import {
    DEFAULT_VFX_CONFIGURATION,
    normalizeVfxConfiguration,
    VFX_FRAME_RATES,
    vfxFrameRateOf,
} from "./vfx";

describe("normalizeVfxConfiguration", () => {
    it("reads a project that has never set a rate as 30", () => {
        // Load-bearing rather than cosmetic: the rate is part of every baked clip's identity, so a
        // different answer here would orphan the clips every existing project already has on disk.
        expect(normalizeVfxConfiguration(undefined).frameRate).toBe(30);
        expect(normalizeVfxConfiguration({}).frameRate).toBe(30);
        expect(DEFAULT_VFX_CONFIGURATION.frameRate).toBe(30);
    });

    it("keeps every rate the panel offers", () => {
        for (const frameRate of VFX_FRAME_RATES) {
            expect(normalizeVfxConfiguration({ frameRate }).frameRate).toBe(frameRate);
        }
    });

    it("offers exactly the four rates, so the panel and the bake cannot drift apart", () => {
        expect([...VFX_FRAME_RATES]).toEqual([30, 48, 60, 120]);
    });

    it("falls back for a rate nothing offers rather than honouring it", () => {
        // A hand-edited manifest, or one written by a newer Studio. Baking at a rate no other reader
        // asks for would produce a file that is never found again.
        for (const stored of [24, 97, 0, -30, 30.5, "60", null, true, NaN]) {
            expect(normalizeVfxConfiguration({ frameRate: stored }).frameRate).toBe(30);
        }
    });

    it("survives a value that is not an object at all", () => {
        for (const stored of ["60", 60, [], null, false]) {
            expect(normalizeVfxConfiguration(stored).frameRate).toBe(30);
        }
    });
});

describe("vfxFrameRateOf", () => {
    it("is the default for the hosts that hold no configuration", () => {
        // A bundle written before the setting existed. Those builds baked at 30, so that is what
        // reading them back has to mean.
        expect(vfxFrameRateOf(undefined)).toBe(30);
    });

    it("is the stored rate for the hosts that do", () => {
        expect(vfxFrameRateOf({ frameRate: 120 })).toBe(120);
    });
});
