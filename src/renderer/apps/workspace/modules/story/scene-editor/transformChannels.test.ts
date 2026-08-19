import { describe, expect, it } from "vitest";
import type { StoryTransformRef } from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import { createTranslator } from "@shared/i18n";
import {
    addableTransformChannels,
    cameraLookCss,
    formatBackdropBlur,
    formatStoryClipShape,
    parseBackdropBlur,
    parseStoryClipShape,
    seedStoryClipShape,
    LOOK_INTENSITY_STEP,
    readCameraLookCss,
    statedTransformChannels,
    TRANSFORM_CHANNELS,
    transformChannelById,
    type ChannelTranslate,
} from "./transformChannels";

const ANY_TARGET = { isText: false };

function idsOf(ref: StoryTransformRef | undefined): string[] {
    return statedTransformChannels(ref).map(channel => channel.id);
}

function addableIds(ref: StoryTransformRef, options = ANY_TARGET): string[] {
    return addableTransformChannels(ref, options).map(channel => channel.id);
}

function add(ref: StoryTransformRef, id: string): StoryTransformRef {
    const channel = transformChannelById(id);
    if (!channel) {
        throw new Error(`No channel ${id}`);
    }
    return channel.add(ref);
}

function remove(ref: StoryTransformRef, id: string): StoryTransformRef {
    const channel = transformChannelById(id);
    if (!channel) {
        throw new Error(`No channel ${id}`);
    }
    return channel.remove(ref);
}

describe("transform channels", () => {
    it("states every channel a row holds, not just the first appearance one", () => {
        // The regression this list exists for: `/transform hero pos=left blur=4 gray=1` is one row
        // stating three channels, and the surface this replaces drew only the filter.
        const ref: StoryTransformRef = {
            mode: "props",
            to: { position: { xalign: 0, yalign: 0.5 }, filter: { blur: 4, grayscale: 1 } },
        };
        expect(idsOf(ref)).toEqual(["position", "filter.blur", "filter.grayscale"]);
    });

    it("reads nothing off an empty ref", () => {
        expect(idsOf(undefined)).toEqual([]);
        expect(idsOf({ mode: "props" })).toEqual([]);
    });

    it("removes a channel rather than neutralising it", () => {
        const ref = add({ mode: "props" }, "zoom");
        expect(ref.to?.zoom).toBe(1);
        const cleared = remove(ref, "zoom");
        expect(cleared.to?.zoom).toBeUndefined();
        expect("zoom" in (cleared.to ?? {})).toBe(false);
    });

    it("clears every mask setting when the mask leaves", () => {
        const ref: StoryTransformRef = {
            mode: "props",
            to: { maskAssetId: "asset", maskSize: "cover", maskRepeat: "no-repeat" },
        };
        expect(idsOf(ref)).toEqual(["mask"]);
        expect(remove(ref, "mask").to).toBeUndefined();
    });

    it("tells a stated mask apart from a restored one", () => {
        expect(idsOf({ mode: "props", to: { maskAssetId: "asset" } })).toEqual(["mask"]);
        expect(idsOf({ mode: "props", to: { maskAssetId: null } })).toEqual(["clear.mask"]);
    });

    it("offers the other filter functions but not a second writer of the CSS channel", () => {
        const ref = add({ mode: "props" }, "filter.blur");
        const addable = addableIds(ref);
        expect(addable).toContain("filter.sepia");
        expect(addable).not.toContain("filter.blur");
        expect(addable).not.toContain("filterRaw");
        expect(addable).not.toContain("look");
        expect(addable).not.toContain("clear.cssFilter");
    });

    it("shuts the structured functions out once a chain is hand-written", () => {
        const ref = add({ mode: "props" }, "filterRaw");
        const addable = addableIds(ref);
        expect(addable).not.toContain("filter.blur");
        expect(addable).not.toContain("look");
    });

    it("offers a restore only while the channel is free", () => {
        expect(addableIds({ mode: "props" })).toContain("clear.clip");
        const clipped = add({ mode: "props" }, "clip");
        expect(addableIds(clipped)).not.toContain("clear.clip");
        expect(addableIds(clipped)).not.toContain("clip");
    });

    it("keeps the font colour for text targets", () => {
        expect(addableIds({ mode: "props" }, { isText: false })).not.toContain("fontColor");
        expect(addableIds({ mode: "props" }, { isText: true })).toContain("fontColor");
    });

    it("seeds a fresh channel with the value that changes nothing", () => {
        expect(add({ mode: "props" }, "filter.blur").to?.filter?.blur).toBe(0);
        expect(add({ mode: "props" }, "filter.brightness").to?.filter?.brightness).toBe(1);
        expect(add({ mode: "props" }, "opacity").to?.opacity).toBe(1);
        expect(add({ mode: "props" }, "rotation").to?.rotation).toBe(0);
    });

    it("round-trips a grade through the CSS it expands to", () => {
        // The row stores only the expanded chain, so the picker can only re-open on the preset if
        // every string the intensity control can write is one the index knows.
        const ref = add({ mode: "props" }, "look");
        const reading = readCameraLookCss(ref.to?.filterRaw);
        expect(reading).not.toBeNull();
        expect(idsOf(ref)).toEqual(["look"]);

        const moved = cameraLookCss(reading!.preset, reading!.intensity - LOOK_INTENSITY_STEP);
        expect(readCameraLookCss(moved)).toEqual({
            preset: reading!.preset,
            intensity: Number((reading!.intensity - LOOK_INTENSITY_STEP).toFixed(2)),
        });
    });

    it("reads a chain the library did not write as a hand-written one", () => {
        expect(idsOf({ mode: "props", to: { filterRaw: "drop-shadow(0 0 4px #000)" } })).toEqual(["filterRaw"]);
        expect(readCameraLookCss("drop-shadow(0 0 4px #000)")).toBeNull();
    });

    it("keeps a channel out of the timing fields it does not own", () => {
        const ref = add({ mode: "props" }, "repeat");
        expect(ref.repeat).toBe(1);
        expect(ref.to).toBeUndefined();
        expect(remove(ref, "repeat").repeat).toBeUndefined();
    });

    it("names every channel with a key the catalogue actually has", () => {
        // A mistyped `story.paramHint.*` key would echo the path into the row rather than fail, and
        // the row is the one place an author cannot argue with a wrong answer.
        const translator = createTranslator("en");
        const asked: TranslationKey[] = [];
        const spy: ChannelTranslate = (key => {
            asked.push(key);
            return key;
        }) as ChannelTranslate;
        for (const channel of TRANSFORM_CHANNELS) {
            channel.label(spy);
        }
        expect(asked.length).toBeGreaterThanOrEqual(TRANSFORM_CHANNELS.length);
        expect(asked.filter(key => !translator.has(key))).toEqual([]);
    });

    it("gives every channel a distinct id", () => {
        const ids = TRANSFORM_CHANNELS.map(channel => channel.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("reads a clip path back as the shape it is", () => {
        expect(parseStoryClipShape("inset(10% 20% 30% 40%)")).toEqual({ kind: "inset", top: 10, right: 20, bottom: 30, left: 40 });
        expect(parseStoryClipShape("circle(45% at 50% 60%)")).toEqual({ kind: "circle", radius: 45, x: 50, y: 60 });
        expect(parseStoryClipShape("ellipse(40% 25% at 50% 50%)")).toEqual({ kind: "ellipse", radiusX: 40, radiusY: 25, x: 50, y: 50 });
    });

    it("keeps a path the shape controls cannot hold", () => {
        // The escape hatch is what stops the visual control from making a hand-written clip
        // unreachable: a polygon opens on the text box rather than being rewritten into a circle.
        const polygon = "polygon(50% 0%, 100% 100%, 0% 100%)";
        expect(parseStoryClipShape(polygon)).toEqual({ kind: "raw", value: polygon });
        expect(formatStoryClipShape({ kind: "raw", value: polygon })).toBe(polygon);
    });

    it("round-trips every shape through its own string", () => {
        for (const kind of ["inset", "circle", "ellipse"] as const) {
            const shape = seedStoryClipShape(kind, { kind: "raw", value: "" });
            expect(parseStoryClipShape(formatStoryClipShape(shape))).toEqual(shape);
        }
    });

    it("opens an empty clip on a shape that crops nothing", () => {
        expect(parseStoryClipShape("")).toEqual({ kind: "inset", top: 0, right: 0, bottom: 0, left: 0 });
        expect(parseStoryClipShape(undefined)).toEqual({ kind: "inset", top: 0, right: 0, bottom: 0, left: 0 });
    });

    it("reads a backdrop blur only when the chain is exactly one", () => {
        expect(parseBackdropBlur("blur(8px)")).toBe(8);
        expect(parseBackdropBlur(formatBackdropBlur(2.5))).toBe(2.5);
        expect(parseBackdropBlur("blur(8px) saturate(1.4)")).toBeNull();
        expect(parseBackdropBlur("")).toBeNull();
    });
});
