import { describe, expect, it } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { weatherBakeKey } from "./bakeKey";
import { DEFAULT_VFX_FRAME_RATE, type VfxConfiguration } from "@shared/types/vfx";
import { weatherFrameCountOf, weatherLoopSecondsOf, type WeatherSeedRef } from "./model";
import { collectWeatherSpecs, weatherClipAssetId, weatherSpecForStage } from "./stage";

const uidoc = (surfaces: { kind: string; designSize?: { width: number; height: number } }[]): UIDocument =>
    ({ surfaces } as unknown as UIDocument);

type Row = Record<string, unknown> & { id: string };

const vfxRow = (id: string, seed: WeatherSeedRef | undefined, extra: Record<string, unknown> = {}): Row => ({
    id,
    kind: "action",
    parentId: null,
    childrenIds: [],
    payload: { action: "vfx", operation: "create", objectName: "weather", ...(seed ? { seed } : {}) },
    ...extra,
});

const story = (blocks: Row[]): StoryDocument =>
    ({
        id: "story-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                rootBlockIds: blocks.map(block => block.id),
                blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
            },
        },
    } as unknown as StoryDocument);

describe("weatherSpecForStage", () => {
    it("takes its size from the stage surface, not from whichever surface comes first", () => {
        const spec = weatherSpecForStage({ seed: "snow" }, uidoc([
            { kind: "page", designSize: { width: 800, height: 600 } },
            { kind: "stageSurface", designSize: { width: 1280, height: 720 } },
        ]), undefined);
        expect(spec).toEqual({
            ref: { seed: "snow" },
            width: 1280,
            height: 720,
            fps: DEFAULT_VFX_FRAME_RATE,
            frames: weatherFrameCountOf({ seed: "snow" }, DEFAULT_VFX_FRAME_RATE),
        });
    });

    it("falls back to the first surface, then to 1080p, rather than refusing", () => {
        // A clip is `cover`-fitted, so a size that is merely close costs nothing an eye can find -
        // and a project mid-edit must not lose its weather over a missing stage.
        expect(weatherSpecForStage({ seed: "rain" }, uidoc([{ kind: "page", designSize: { width: 640, height: 360 } }]), undefined))
            .toMatchObject({ width: 640, height: 360 });
        expect(weatherSpecForStage({ seed: "rain" }, uidoc([]), undefined)).toMatchObject({ width: 1920, height: 1080 });
        expect(weatherSpecForStage({ seed: "rain" }, undefined, undefined)).toMatchObject({ width: 1920, height: 1080 });
    });

    it("makes the clip at the resolution the project was created at, 4K included", () => {
        // The stage size is chosen once, in the wizard, and is the coordinate system everything else
        // is drawn in. A clip made smaller than it would be the one layer arriving stretched.
        expect(weatherSpecForStage({ seed: "snow" }, uidoc([
            { kind: "stageSurface", designSize: { width: 3840, height: 2160 } },
        ]), undefined)).toMatchObject({ width: 3840, height: 2160 });
    });
});

describe("weatherClipAssetId", () => {
    it("is the bake key, so the size and every parameter are part of the address", () => {
        const stage = uidoc([{ kind: "stageSurface", designSize: { width: 1280, height: 720 } }]);
        const small = weatherSpecForStage({ seed: "snow" }, stage, undefined);
        const large = weatherSpecForStage({ seed: "snow" }, uidoc([{ kind: "stageSurface", designSize: { width: 1920, height: 1080 } }]), undefined);
        const tweaked = weatherSpecForStage({ seed: "snow", params: { density: 900 } }, stage, undefined);
        const faster = weatherSpecForStage({ seed: "snow" }, stage, { frameRate: 60 });

        expect(weatherClipAssetId(small)).toBe(`weather-clip:${weatherBakeKey(small)}`);
        expect(weatherClipAssetId(small)).not.toBe(weatherClipAssetId(large));
        expect(weatherClipAssetId(small)).not.toBe(weatherClipAssetId(tweaked));
        // The rate is part of the address as much as the size is. Without this a project that
        // raised it would be handed the clip baked at the previous rate for ever.
        expect(weatherClipAssetId(small)).not.toBe(weatherClipAssetId(faster));
    });
});

describe("collectWeatherSpecs", () => {
    it("finds every seed a story names, once per distinct clip", () => {
        const specs = collectWeatherSpecs([story([
            vfxRow("a", { seed: "snow" }),
            // Same clip asked for twice: one file, not two.
            vfxRow("b", { seed: "snow" }),
            vfxRow("c", { seed: "rain" }),
            // A different parameter is a different picture.
            vfxRow("d", { seed: "rain", params: { density: 900 } }),
        ])], uidoc([{ kind: "stageSurface", designSize: { width: 1920, height: 1080 } }]), undefined);

        expect(specs.map(spec => spec.ref)).toEqual([
            { seed: "snow" },
            { seed: "rain" },
            { seed: "rain", params: { density: 900 } },
        ]);
    });

    it("counts a seed on any vfx row, because the compiler reads it off whichever row names the overlay first", () => {
        const specs = collectWeatherSpecs([story([
            { ...vfxRow("a", { seed: "sakura" }), payload: { action: "vfx", operation: "show", objectName: "petals", seed: { seed: "sakura" } } },
        ])], undefined, undefined);
        expect(specs).toHaveLength(1);
    });

    it("ignores rows that are not weather, and rows the author disabled", () => {
        const specs = collectWeatherSpecs([story([
            vfxRow("clip", undefined),
            { ...vfxRow("off", { seed: "snow" }), disabled: true },
            { ...vfxRow("other", { seed: "snow" }), payload: { action: "image", operation: "create" } },
        ])], undefined, undefined);
        expect(specs).toEqual([]);
    });

    it("answers nothing for a project with no stories at all", () => {
        expect(collectWeatherSpecs([], undefined, undefined)).toEqual([]);
    });
});

describe("the project frame rate", () => {
    const rate = (vfx: VfxConfiguration | undefined) =>
        weatherSpecForStage({ seed: "snow" }, undefined, vfx);

    it("is 30 for a project that has never set one, so nothing already baked is orphaned", () => {
        expect(rate(undefined)).toMatchObject({ fps: 30, frames: weatherFrameCountOf({ seed: "snow" }, 30) });
    });

    it("carries the frame count with it, because the seam is phases of `frames`", () => {
        // The count is the effect's derived LENGTH times the rate, so raising the rate buys smoother
        // motion over the same span of time rather than a longer clip.
        const seconds = weatherLoopSecondsOf({ seed: "snow" });
        for (const frameRate of [30, 48, 60, 120] as const) {
            expect(rate({ frameRate })).toMatchObject({
                fps: frameRate,
                frames: Math.round(seconds * frameRate),
            });
        }
    });

    it("does not let the length depend on the rate", () => {
        // Two projects at different rates must describe the same weather for the same span, or the
        // rate quietly becomes a speed control.
        const at = (frameRate: 30 | 120) => rate({ frameRate });
        // Not exactly: the derived length is a whole number of CROSSINGS rather than of frames, so
        // each rate rounds it to its own grid. Within a frame of each other is the guarantee.
        expect(Math.abs(at(30).frames / 30 - at(120).frames / 120)).toBeLessThan(1 / 30);
    });

    it("falls back rather than honouring a rate nothing offers", () => {
        // A hand-edited manifest. Baking at 97 would address a file no other reader ever asks for.
        expect(rate({ frameRate: 97 } as unknown as VfxConfiguration)).toMatchObject({ fps: 30 });
    });
});
