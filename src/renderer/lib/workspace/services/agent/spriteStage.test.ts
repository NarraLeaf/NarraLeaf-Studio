import { describe, expect, it } from "vitest";
import { drawnBoxAtCenter, entranceForFirstArt, framedEntrance, stageSizeOf, standingEntrance } from "./spriteStage";

const STAGE = { width: 1920, height: 1080 };
const SPRITE = { width: 700, height: 1000 };

describe("sprite stage geometry", () => {
    it("reproduces what the playtest showed for the skeleton's tuned character", () => {
        // The skeleton's demo character carries zoom 0.624 and yoffset -50 for its own art; a 700x1000
        // sprite put on it came out ~437x624 centred near y=590, as the acceptance run measured.
        const box = drawnBoxAtCenter(SPRITE, { position: { xalign: 0.5, yalign: 0.5, yoffset: -50 }, zoom: 0.624 }, STAGE);
        expect(box).toEqual({ left: 742, top: 278, width: 437, height: 624 });
    });

    it("draws a character with no defaults at its own pixels, centred", () => {
        expect(drawnBoxAtCenter(SPRITE, undefined, STAGE)).toEqual({ left: 610, top: 40, width: 700, height: 1000 });
    });

    it("stands a sprite on the bottom edge at its own size", () => {
        const entrance = standingEntrance(SPRITE, STAGE);
        expect(entrance).toEqual({ position: { xalign: 0.5, yalign: 0.5, yoffset: -40 } });
        const box = drawnBoxAtCenter(SPRITE, entrance, STAGE);
        expect(box.top + box.height).toBe(1080);
        expect(box.height).toBe(1000);
    });

    it("scales a sprite taller than the stage down to fit, feet still on the edge", () => {
        const sprite = { width: 1200, height: 2000 };
        const entrance = standingEntrance(sprite, STAGE);
        expect(entrance.zoom).toBe(0.54);
        const box = drawnBoxAtCenter(sprite, entrance, STAGE);
        expect(box.top).toBe(0);
        expect(box.top + box.height).toBe(1080);
    });

    it("frames a full-length sprite the way visual novels do: head under the top, top 80% on stage", () => {
        const sprite = { width: 1088, height: 1984 };
        const entrance = framedEntrance(sprite, STAGE);
        const box = drawnBoxAtCenter(sprite, entrance, STAGE);
        // 4% of the stage above the head; the bottom edge cuts her four fifths of the way down.
        expect(box.top).toBe(43);
        expect((STAGE.height - box.top) / box.height).toBeCloseTo(0.8, 2);
        expect(entrance.position).toMatchObject({ xalign: 0.5, yalign: 0.5 });
    });

    it("scales a small full-length sprite up to the same framing", () => {
        const sprite = { width: 400, height: 900 };
        const box = drawnBoxAtCenter(sprite, framedEntrance(sprite, STAGE), STAGE);
        expect(box.top).toBe(43);
        expect((STAGE.height - box.top) / box.height).toBeCloseTo(0.8, 2);
    });

    it("stands a bust whole on the bottom edge instead of cutting it", () => {
        const bust = { width: 1200, height: 1400 };
        const entrance = framedEntrance(bust, STAGE);
        const box = drawnBoxAtCenter(bust, entrance, STAGE);
        // Top and height round apart, so the bottom can land a pixel short.
        expect(Math.abs(box.top + box.height - 1080)).toBeLessThanOrEqual(1);
        expect(box.top).toBeGreaterThanOrEqual(42);
        // One that fits already is left at its own pixels.
        expect(framedEntrance(SPRITE, STAGE)).toEqual(standingEntrance(SPRITE, STAGE));
    });

    it("reads the project's resolution in either stored shape", () => {
        expect(stageSizeOf({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
        expect(stageSizeOf("2560x1440")).toEqual({ width: 2560, height: 1440 });
        expect(stageSizeOf(undefined)).toEqual(STAGE);
    });
});

describe("a character's first art", () => {
    // 美绪 from a 1600x1586 PSD came on at her own pixels, 1.6 times Narra, head out of the stage.
    const MIO = { width: 1600, height: 1586 };

    it("gives her the standard framing, head on the stage", () => {
        expect(entranceForFirstArt({ hadArt: false, current: undefined, sprite: MIO, stage: STAGE })).toEqual(framedEntrance(MIO, STAGE));
        expect(drawnBoxAtCenter(MIO, entranceForFirstArt({ hadArt: false, current: undefined, sprite: MIO, stage: STAGE }), STAGE).height).toBeLessThanOrEqual(STAGE.height);
    });

    it("leaves defaults an author set, art being replaced, and art it cannot measure", () => {
        const set = { zoom: 0.5 };
        expect(entranceForFirstArt({ hadArt: false, current: set, sprite: MIO, stage: STAGE })).toBeUndefined();
        expect(entranceForFirstArt({ hadArt: true, current: undefined, sprite: MIO, stage: STAGE })).toBeUndefined();
        expect(entranceForFirstArt({ hadArt: false, current: undefined, sprite: null, stage: STAGE })).toBeUndefined();
    });
});
