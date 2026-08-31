import { describe, expect, it } from "vitest";
import type { StoryAnimationAsset } from "../types/story";
import type { ProjectTransformPreset } from "../types/transformPreset";
import {
    decodeStoryMotionExchange,
    decodeTransformPresetExchange,
    encodeStoryMotionExchange,
    encodeTransformPresetExchange,
    libraryExchangeFileName,
    LIBRARY_EXCHANGE_FORMAT,
    LIBRARY_EXCHANGE_VERSION,
} from "./libraryExchange";

const preset = (name: string): ProjectTransformPreset => ({
    id: "t1",
    name,
    transform: { mode: "props", to: { position: { xalign: 0.25, yalign: 0.5 } }, durationMs: 400 },
});

const motion = (over: Partial<StoryAnimationAsset> = {}): StoryAnimationAsset => ({
    schemaVersion: 1,
    id: "anim-1",
    name: "Shake",
    targetKind: "camera",
    timeline: {
        durationMs: 600,
        tracks: [{ id: "tr1", property: "rotation", keyframes: [{ id: "k1", timeMs: 0, value: 0 }] }],
    },
    sequences: [{ id: "s1", props: { rotation: 4 } }],
    config: { repeat: 2 },
    previewAssetId: "asset-from-the-other-project",
    previewBackgroundAssetId: "background-from-the-other-project",
    meta: { createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
    ...over,
} as StoryAnimationAsset);

describe("exporting a library", () => {
    it("writes the envelope every reader checks first", () => {
        const parsed = JSON.parse(encodeTransformPresetExchange([preset("Enter")]));

        expect(parsed.format).toBe(LIBRARY_EXCHANGE_FORMAT);
        expect(parsed.version).toBe(LIBRARY_EXCHANGE_VERSION);
        expect(parsed.kind).toBe("transform-preset");
        expect(parsed.items).toEqual([{ name: "Enter", transform: preset("Enter").transform }]);
    });

    /**
     * The reason a motion cannot simply be copied out: the two preview ids point at images in the
     * project it came from, and the compiler never reads them.
     */
    it("leaves a motion's preview images, id and timestamps behind", () => {
        const parsed = JSON.parse(encodeStoryMotionExchange([motion()]));

        expect(parsed.items).toEqual([{
            name: "Shake",
            targetKind: "camera",
            timeline: motion().timeline,
            sequences: motion().sequences,
            config: { repeat: 2 },
        }]);
    });

    it("names the file after the item when there is one, after the library when there are several", () => {
        expect(libraryExchangeFileName("transform-preset", ["向左入场 + 模糊"])).toBe("向左入场 + 模糊.json");
        expect(libraryExchangeFileName("transform-preset", ["a", "b"])).toBe("transform-presets.json");
        expect(libraryExchangeFileName("story-motion", ["a/b:c"])).toBe("a b c.json");
        // A name made entirely of characters a path cannot hold still has to produce a file name.
        expect(libraryExchangeFileName("story-motion", ["///"])).toBe("story-motions.json");
    });
});

describe("importing a library", () => {
    it("round-trips what it exported", () => {
        const result = decodeTransformPresetExchange(encodeTransformPresetExchange([preset("Enter")]));

        expect(result).toEqual({ ok: true, items: [{ name: "Enter", transform: preset("Enter").transform }] });
    });

    it("round-trips a motion", () => {
        const result = decodeStoryMotionExchange(encodeStoryMotionExchange([motion()]));

        expect(result.ok).toBe(true);
        expect(result.ok && result.items[0].targetKind).toBe("camera");
        expect(result.ok && result.items[0]).not.toHaveProperty("previewAssetId");
    });

    /** Each failure asks something different of the author, so each one is its own word. */
    it("says which kind of file it could not read", () => {
        expect(decodeTransformPresetExchange("not json")).toEqual({ ok: false, reason: "unreadable" });
        expect(decodeTransformPresetExchange(JSON.stringify({ format: "something.else", version: 1 })))
            .toEqual({ ok: false, reason: "unreadable" });
        expect(decodeTransformPresetExchange(encodeStoryMotionExchange([motion()])))
            .toEqual({ ok: false, reason: "wrongKind" });
        expect(decodeTransformPresetExchange(JSON.stringify({
            format: LIBRARY_EXCHANGE_FORMAT,
            version: LIBRARY_EXCHANGE_VERSION + 1,
            kind: "transform-preset",
            items: [],
        }))).toEqual({ ok: false, reason: "tooNew" });
        expect(decodeTransformPresetExchange(JSON.stringify({
            format: LIBRARY_EXCHANGE_FORMAT,
            version: LIBRARY_EXCHANGE_VERSION,
            kind: "transform-preset",
            items: [{ name: "", transform: {} }],
        }))).toEqual({ ok: false, reason: "empty" });
    });

    it("keeps the items it understands and drops the ones it does not", () => {
        const file = JSON.stringify({
            format: LIBRARY_EXCHANGE_FORMAT,
            version: LIBRARY_EXCHANGE_VERSION,
            kind: "transform-preset",
            items: [
                { name: "Good", transform: { to: { opacity: 1 } } },
                { name: "States nothing", transform: {} },
                "not an object",
            ],
        });

        const result = decodeTransformPresetExchange(file);

        expect(result.ok && result.items.map(item => item.name)).toEqual(["Good"]);
    });

    /**
     * An unknown target kind is refused rather than read as `image`: a camera move arriving as a
     * sprite move would look like a Studio bug instead of an unreadable file.
     */
    it("refuses a motion whose target kind or movement it cannot read", () => {
        const withKind = (targetKind: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
            format: LIBRARY_EXCHANGE_FORMAT,
            version: LIBRARY_EXCHANGE_VERSION,
            kind: "story-motion",
            items: [{ name: "X", targetKind, sequences: [{ id: "s", props: { opacity: 1 } }], ...extra }],
        });

        expect(decodeStoryMotionExchange(withKind("vfx"))).toEqual({ ok: false, reason: "empty" });
        expect(decodeStoryMotionExchange(withKind("image", { sequences: [] }))).toEqual({ ok: false, reason: "empty" });
        expect(decodeStoryMotionExchange(withKind("image")).ok).toBe(true);
    });
});
