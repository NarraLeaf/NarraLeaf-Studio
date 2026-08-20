import { describe, expect, it } from "vitest";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { weatherBakeKey } from "./bakeKey";
import { WEATHER_FPS, WEATHER_LOOP_SECONDS, type WeatherSeedRef } from "./model";
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
        ]));
        expect(spec).toEqual({
            ref: { seed: "snow" },
            width: 1280,
            height: 720,
            fps: WEATHER_FPS,
            frames: WEATHER_LOOP_SECONDS * WEATHER_FPS,
        });
    });

    it("falls back to the first surface, then to 1080p, rather than refusing", () => {
        // A clip is `cover`-fitted, so a size that is merely close costs nothing an eye can find -
        // and a project mid-edit must not lose its weather over a missing stage.
        expect(weatherSpecForStage({ seed: "rain" }, uidoc([{ kind: "page", designSize: { width: 640, height: 360 } }])))
            .toMatchObject({ width: 640, height: 360 });
        expect(weatherSpecForStage({ seed: "rain" }, uidoc([]))).toMatchObject({ width: 1920, height: 1080 });
        expect(weatherSpecForStage({ seed: "rain" }, undefined)).toMatchObject({ width: 1920, height: 1080 });
    });

    it("caps the bake so a 4K stage does not bake a 4K clip", () => {
        expect(weatherSpecForStage({ seed: "snow" }, uidoc([
            { kind: "stageSurface", designSize: { width: 3840, height: 2160 } },
        ]))).toMatchObject({ width: 1920, height: 1080 });
    });
});

describe("weatherClipAssetId", () => {
    it("is the bake key, so the size and every parameter are part of the address", () => {
        const small = weatherSpecForStage({ seed: "snow" }, uidoc([{ kind: "stageSurface", designSize: { width: 1280, height: 720 } }]));
        const large = weatherSpecForStage({ seed: "snow" }, uidoc([{ kind: "stageSurface", designSize: { width: 1920, height: 1080 } }]));
        const tweaked = weatherSpecForStage({ seed: "snow", params: { density: 900 } }, uidoc([{ kind: "stageSurface", designSize: { width: 1280, height: 720 } }]));

        expect(weatherClipAssetId(small)).toBe(`weather-clip:${weatherBakeKey(small)}`);
        expect(weatherClipAssetId(small)).not.toBe(weatherClipAssetId(large));
        expect(weatherClipAssetId(small)).not.toBe(weatherClipAssetId(tweaked));
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
        ])], uidoc([{ kind: "stageSurface", designSize: { width: 1920, height: 1080 } }]));

        expect(specs.map(spec => spec.ref)).toEqual([
            { seed: "snow" },
            { seed: "rain" },
            { seed: "rain", params: { density: 900 } },
        ]);
    });

    it("counts a seed on any vfx row, because the compiler reads it off whichever row names the overlay first", () => {
        const specs = collectWeatherSpecs([story([
            { ...vfxRow("a", { seed: "sakura" }), payload: { action: "vfx", operation: "show", objectName: "petals", seed: { seed: "sakura" } } },
        ])], undefined);
        expect(specs).toHaveLength(1);
    });

    it("ignores rows that are not weather, and rows the author disabled", () => {
        const specs = collectWeatherSpecs([story([
            vfxRow("clip", undefined),
            { ...vfxRow("off", { seed: "snow" }), disabled: true },
            { ...vfxRow("other", { seed: "snow" }), payload: { action: "image", operation: "create" } },
        ])], undefined);
        expect(specs).toEqual([]);
    });

    it("answers nothing for a project with no stories at all", () => {
        expect(collectWeatherSpecs([], undefined)).toEqual([]);
    });
});
