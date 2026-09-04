import { describe, expect, it } from "vitest";
import {
    inheritedCharacterEntranceProps,
    mergeCharacterEntranceProps,
    sanitizeCharacterEntranceProps,
    withCharacterEntranceDefaults,
} from "./characterEntrance";

describe("sanitizeCharacterEntranceProps", () => {
    it("keeps the channels an entrance can act on", () => {
        expect(sanitizeCharacterEntranceProps({
            zoom: 0.54,
            scaleX: -1,
            rotation: 0,
            opacity: 1,
            position: { xalign: 0.5, yalign: 0.1 },
            mixBlendMode: "multiply",
            clipPath: null,
        })).toEqual({
            zoom: 0.54,
            scaleX: -1,
            rotation: 0,
            opacity: 1,
            position: { xalign: 0.5, yalign: 0.1 },
            mixBlendMode: "multiply",
            clipPath: null,
        });
    });

    it("drops what an entrance cannot act on", () => {
        // A mask needs an await the entrance's single statement has no room for; the lens is the
        // camera's own glass; `fontColor` belongs to a text object.
        expect(sanitizeCharacterEntranceProps({
            zoom: 0.5,
            maskAssetId: "asset-mask",
            maskSize: "cover",
            fontColor: "#fff",
            shutter: 0.5,
            lens: { preset: "blink" },
        })).toEqual({ zoom: 0.5 });
    });

    it("refuses values that are not what the channel holds", () => {
        expect(sanitizeCharacterEntranceProps({
            zoom: "0.5",
            scaleY: Number.NaN,
            position: { xalign: "left", yalign: 0.2 },
            mixBlendMode: 7,
        })).toEqual({ position: { yalign: 0.2 } });
    });

    it("keeps one filter writer, and nothing at all from an empty bag", () => {
        expect(sanitizeCharacterEntranceProps({
            filter: { blur: 2 },
            filterRaw: "blur(4px)",
            look: { preset: "memory" },
        })).toEqual({ filter: { blur: 2 } });
        expect(sanitizeCharacterEntranceProps({})).toBeUndefined();
        expect(sanitizeCharacterEntranceProps(null)).toBeUndefined();
        expect(sanitizeCharacterEntranceProps("zoom")).toBeUndefined();
    });
});

describe("mergeCharacterEntranceProps", () => {
    const defaults = { zoom: 0.54, scaleX: -1, position: { xalign: 0.5, yalign: 0.1 } };

    it("falls back channel by channel", () => {
        expect(mergeCharacterEntranceProps(defaults, { zoom: 1.2 }))
            .toEqual({ zoom: 1.2, scaleX: -1, position: { xalign: 0.5, yalign: 0.1 } });
    });

    it("merges a position by its axes, not as one object", () => {
        expect(mergeCharacterEntranceProps(defaults, { position: { xalign: 0 } }))
            .toEqual({ zoom: 0.54, scaleX: -1, position: { xalign: 0, yalign: 0.1 } });
    });

    it("gives the whole filter channel to whichever writer the row states", () => {
        expect(mergeCharacterEntranceProps({ zoom: 1, filter: { blur: 2 } }, { filterRaw: "sepia(1)" }))
            .toEqual({ zoom: 1, filterRaw: "sepia(1)" });
        expect(mergeCharacterEntranceProps({ filter: { blur: 2 } }, { zoom: 1.1 }))
            .toEqual({ filter: { blur: 2 }, zoom: 1.1 });
    });

    it("is the row's own bag when the character has no defaults", () => {
        expect(mergeCharacterEntranceProps(undefined, { zoom: 1.2 })).toEqual({ zoom: 1.2 });
        expect(mergeCharacterEntranceProps(undefined, undefined)).toBeUndefined();
    });
});

describe("withCharacterEntranceDefaults", () => {
    const defaults = { zoom: 0.54 };

    it("folds the defaults into a props ref, keeping its timing", () => {
        expect(withCharacterEntranceDefaults(defaults, { durationMs: 300, to: { opacity: 1 } }))
            .toEqual({ mode: "props", durationMs: 300, to: { zoom: 0.54, opacity: 1 } });
    });

    it("builds a ref for a row that states none", () => {
        expect(withCharacterEntranceDefaults(defaults, undefined)).toEqual({ mode: "props", to: { zoom: 0.54 } });
    });

    it("leaves a motion ref alone", () => {
        // A Story Motion states its own keyframes; the defaults reach it as the element's
        // constructor pose instead.
        const motion = { mode: "animation" as const, animationId: "anim-1" };
        expect(withCharacterEntranceDefaults(defaults, motion)).toBe(motion);
    });
});

describe("inheritedCharacterEntranceProps", () => {
    const defaults = { zoom: 0.54, scaleX: -1, position: { xalign: 0.5, yalign: 0.1 } };

    it("is what the row does not state", () => {
        expect(inheritedCharacterEntranceProps(defaults, { to: { zoom: 1.2 } }))
            .toEqual({ scaleX: -1, position: { xalign: 0.5, yalign: 0.1 } });
    });

    it("counts a position axis at a time", () => {
        expect(inheritedCharacterEntranceProps(defaults, { to: { position: { xalign: 0 } } }))
            .toEqual({ zoom: 0.54, scaleX: -1, position: { yalign: 0.1 } });
    });

    it("is nothing when the row states every channel, and nothing under a motion", () => {
        expect(inheritedCharacterEntranceProps({ zoom: 0.54 }, { to: { zoom: 1 } })).toBeUndefined();
        expect(inheritedCharacterEntranceProps(defaults, { mode: "animation", animationId: "anim-1" })).toBeUndefined();
        expect(inheritedCharacterEntranceProps(undefined, { to: {} })).toBeUndefined();
    });
});
