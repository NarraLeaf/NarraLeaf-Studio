import { describe, expect, it } from "vitest";
import { drawnBoxAtCenter, entranceForFirstArt, stageSizeOf, standingEntrance } from "./spriteStage";

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

    it("reads the project's resolution in either stored shape", () => {
        expect(stageSizeOf({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
        expect(stageSizeOf("2560x1440")).toEqual({ width: 2560, height: 1440 });
        expect(stageSizeOf(undefined)).toEqual(STAGE);
    });
});

describe("a character's first art", () => {
    // 美绪 from a 1600x1586 PSD came on at her own pixels, 1.6 times Narra, head out of the stage.
    const MIO = { width: 1600, height: 1586 };

    it("stands her on the floor, scaled to fit the stage", () => {
        expect(entranceForFirstArt({ hadArt: false, current: undefined, sprite: MIO, stage: STAGE })).toEqual(standingEntrance(MIO, STAGE));
        expect(drawnBoxAtCenter(MIO, entranceForFirstArt({ hadArt: false, current: undefined, sprite: MIO, stage: STAGE }), STAGE).height).toBeLessThanOrEqual(STAGE.height);
    });

    it("leaves defaults an author set, art being replaced, and art it cannot measure", () => {
        const set = { zoom: 0.5 };
        expect(entranceForFirstArt({ hadArt: false, current: set, sprite: MIO, stage: STAGE })).toBeUndefined();
        expect(entranceForFirstArt({ hadArt: true, current: undefined, sprite: MIO, stage: STAGE })).toBeUndefined();
        expect(entranceForFirstArt({ hadArt: false, current: undefined, sprite: null, stage: STAGE })).toBeUndefined();
    });
});
