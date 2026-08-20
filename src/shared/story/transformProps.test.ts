import { describe, expect, it } from "vitest";
import {
    composeStoryFilter,
    isMirrorTransform,
    parseStoryFilter,
    splitStoryTransformChange,
    storyTransformPropsConflicts,
    storyTransformPropsToNlr,
} from "./transformProps";
import { expandLegacyDisplayableEffect, expandLegacyTransformPreset } from "./transformLegacy";

describe("the structured filter", () => {
    it("emits in one canonical order whatever order the record was built in, with the right units", () => {
        // The property that makes the record a VALUE: a CSS filter is a pipeline, so order is part of
        // what it means, and a record has none. Two records with the same entries must therefore print
        // the same string, or the same row would render differently depending on which control wrote it
        // last and a document diff would move under an author who changed nothing.
        const forwards = composeStoryFilter({ grayscale: 1, sepia: 1, hueRotate: 185, saturate: 4, brightness: 0.55, blur: 2 });
        const backwards = composeStoryFilter({ blur: 2, brightness: 0.55, saturate: 4, hueRotate: 185, sepia: 1, grayscale: 1 });
        expect(forwards).toBe(backwards);
        expect(forwards).toBe("grayscale(1) sepia(1) hue-rotate(185deg) saturate(4) brightness(0.55) blur(2px)");
    });

    it("is `none` when the record is empty or absent, which is what a cleared filter says", () => {
        expect(composeStoryFilter({})).toBe("none");
        expect(composeStoryFilter(null)).toBe("none");
    });

    it("drops a non-finite term rather than printing it", () => {
        // A browser that cannot parse ONE function drops the WHOLE declaration, so `saturate(NaN)`
        // would not weaken a grade, it would silently remove it.
        expect(composeStoryFilter({ brightness: 0.5, saturate: Number.NaN })).toBe("brightness(0.5)");
    });

    it("reads a canonical string back into the record that produced it", () => {
        expect(parseStoryFilter("blur(4px)")).toEqual({ filter: { blur: 4 } });
        expect(parseStoryFilter("grayscale(1) sepia(1) hue-rotate(185deg)")).toEqual({ filter: { grayscale: 1, sepia: 1, hueRotate: 185 } });
        expect(parseStoryFilter("saturate(50%)")).toEqual({ filter: { saturate: 0.5 } });
        expect(parseStoryFilter("none")).toEqual({ filter: {} });
    });

    it("refuses a chain the record cannot hold, and says so by handing back the raw string", () => {
        // Out of canonical order: storing it structurally would re-emit it reordered, which is a
        // different picture. A parse that silently changed what a document looks like is worse than
        // no parse at all.
        expect(parseStoryFilter("blur(5px) brightness(0.75)")).toEqual({ filterRaw: "blur(5px) brightness(0.75)" });
        // Not a single-scalar function.
        expect(parseStoryFilter("drop-shadow(2px 2px 4px #000)")).toEqual({ filterRaw: "drop-shadow(2px 2px 4px #000)" });
        // Something the parse did not see: half a filter is not a filter.
        expect(parseStoryFilter("blur(4px) url(#f)")).toEqual({ filterRaw: "blur(4px) url(#f)" });
    });

    it("calls a bag carrying both filter forms a conflict rather than picking one", () => {
        expect(storyTransformPropsConflicts({ filter: { blur: 1 }, filterRaw: "blur(1px)" })).toEqual(["filterBoth"]);
        expect(storyTransformPropsConflicts({ filter: { blur: 1 } })).toEqual([]);
    });
});

describe("cut vs tween", () => {
    const tweened = (from: Parameters<typeof splitStoryTransformChange>[0], to: Parameters<typeof splitStoryTransformChange>[1]) =>
        Object.keys(splitStoryTransformChange(from, to).tween);
    const cut = (from: Parameters<typeof splitStoryTransformChange>[0], to: Parameters<typeof splitStoryTransformChange>[1]) =>
        Object.keys(splitStoryTransformChange(from, to).cut);

    it("eases every numeric geometry prop", () => {
        expect(tweened(undefined, { position: { xalign: 0.25 }, zoom: 1.4, scaleX: -1, scaleY: 2, rotation: 90, opacity: 0.5 }))
            .toEqual(["position", "zoom", "scaleX", "scaleY", "rotation", "opacity"]);
    });

    it("cuts every discrete channel, the way the keyframe layer already holds a string", () => {
        expect(cut(undefined, {
            maskAssetId: "a", maskSize: "cover", maskPosition: "50% 50%", maskRepeat: "no-repeat",
            maskMode: "alpha", clipPath: "circle(40%)", mixBlendMode: "screen", filterRaw: "blur(2px)",
            fontColor: "#fff", backdropFilter: "blur(8px)",
        })).toHaveLength(10);
    });

    it("eases a filter whose hue angle does not move — which is the commonest dim there is", () => {
        // Neutral to `brightness(0.6)`: expanded onto the union both endpoints read `hue-rotate(0deg)`,
        // so nothing walks the colour wheel and fading is exactly what the author asked for.
        expect(tweened(undefined, { filter: { brightness: 0.6 } })).toEqual(["filter"]);
        // Two strengths of one grade hold their angle constant and tween for the same reason.
        expect(tweened({ filter: { grayscale: 1, sepia: 1, hueRotate: 185, saturate: 4 } }, { filter: { grayscale: 1, sepia: 1, hueRotate: 185, saturate: 2 } }))
            .toEqual(["filter"]);
    });

    it("cuts a filter whose hue angle moves at all, INCLUDING from the identity", () => {
        // The measured case from `1e626400`: easing `moonlight` on from neutral sweeps the angle
        // 0 -> 185 while `grayscale` lets the source's own hues back in, and the midpoint is a green
        // face. There is no interpolation that fixes it, so it lands in one frame.
        expect(cut(undefined, { filter: { grayscale: 1, sepia: 1, hueRotate: 185, saturate: 4, brightness: 0.55 } })).toEqual(["filter"]);
        expect(cut({ filter: { hueRotate: 90 } }, { filter: { hueRotate: 0 } })).toEqual(["filter"]);
    });

    it("puts the cut half and the eased half in separate halves of one change", () => {
        const change = splitStoryTransformChange(undefined, { zoom: 1.4, filterRaw: "sepia(1)" });
        expect(Object.keys(change.cut)).toEqual(["filterRaw"]);
        expect(Object.keys(change.tween)).toEqual(["zoom"]);
    });
});

describe("the bag in the engine's spelling", () => {
    it("turns a clear into the CSS neutral, and a blend clear into `normal`", () => {
        expect(storyTransformPropsToNlr({ clipPath: null, backdropFilter: null, mixBlendMode: null, filter: null }))
            .toEqual({ clipPath: "none", backdropFilter: "none", mixBlendMode: "normal", filter: "none" });
    });

    it("leaves the mask asset out — only the compiler can resolve one, and it must register a preload", () => {
        expect(storyTransformPropsToNlr({ maskAssetId: "asset-1", zoom: 2 })).toEqual({ zoom: 2 });
    });
});

describe("a mirror is a lone negative scaleX", () => {
    it("is recognised by the channel it touches, not by a name", () => {
        expect(isMirrorTransform({ to: { scaleX: -1 } })).toBe(true);
        expect(isMirrorTransform({ to: { scaleX: 1 } })).toBe(true);
        // Two axes is a scale, not a mirror: a mirror never writes `scaleY`, because doing so would
        // reset a vertical scale an earlier row had set.
        expect(isMirrorTransform({ to: { scaleX: -1, scaleY: 1 } })).toBe(false);
        expect(isMirrorTransform(undefined)).toBe(false);
    });
});

describe("the v17 -> v18 expansion tables", () => {
    it("expands all twenty transform presets, and only three of them leave the bag", () => {
        expect(expandLegacyTransformPreset("none").to).toEqual({});
        expect(expandLegacyTransformPreset("left").to).toEqual({ position: { xalign: 0.25, yalign: 0.5 } });
        expect(expandLegacyTransformPreset("center").to).toEqual({ position: { xalign: 0.5, yalign: 0.5 } });
        expect(expandLegacyTransformPreset("right").to).toEqual({ position: { xalign: 0.75, yalign: 0.5 } });
        expect(expandLegacyTransformPreset("custom", { xalign: 0.1, yoffset: -12 }).to)
            .toEqual({ position: { xalign: 0.1, yalign: 0.5, yoffset: -12 } });
        expect(expandLegacyTransformPreset("fadeIn").to).toEqual({ opacity: 1 });
        expect(expandLegacyTransformPreset("fadeOut").to).toEqual({ opacity: 0 });
        expect(expandLegacyTransformPreset("slideLeft").to).toEqual({ position: { xalign: 0.25, yalign: 0.5 } });
        expect(expandLegacyTransformPreset("slideRight").to).toEqual({ position: { xalign: 0.75, yalign: 0.5 } });
        // The vertical slides land at 0.5, not at the 0.7 / 0.3 `getPresetPosition` appears to say.
        // Its `yalign` local already defaults to 0.5 before the switch, so the `?? 0.7` after it is
        // unreachable and always was. The expansion reproduces what those presets DID, not what the
        // source reads as - a migration that quietly moved every existing slide row would be worse
        // than a dead default nobody has noticed.
        expect(expandLegacyTransformPreset("slideUp").to).toEqual({ position: { xalign: 0.5, yalign: 0.5 } });
        expect(expandLegacyTransformPreset("slideDown").to).toEqual({ position: { xalign: 0.5, yalign: 0.5 } });
        expect(expandLegacyTransformPreset("zoom", { zoom: 1.4 }).to).toEqual({ zoom: 1.4 });
        expect(expandLegacyTransformPreset("scale", { scale: 1.2 }).to).toEqual({ scaleX: 1.2, scaleY: 1.2 });
        expect(expandLegacyTransformPreset("rotate", { degrees: 90 }).to).toEqual({ rotation: 90 });
        // `Displayable.scale` documents "use negative value to invert the scale", and a flip is
        // horizontal by definition - `scaleY` stays untouched on purpose.
        expect(expandLegacyTransformPreset("flip").to).toEqual({ scaleX: -1 });
        expect(expandLegacyTransformPreset("opacity", { opacity: 0.4 }).to).toEqual({ opacity: 0.4 });
        // `Displayable.darken(d)` IS `filter("brightness(1 - d)")`.
        expect(expandLegacyTransformPreset("darken", { darkness: 0.6 }).to).toEqual({ filter: { brightness: 0.4 } });
        // The three that are generators rather than values: they synthesize a clip-path per frame.
        expect(expandLegacyTransformPreset("circleReveal", { center: "20% 40%" })).toEqual({ to: {}, clipReveal: { kind: "circleReveal", center: "20% 40%" } });
        expect(expandLegacyTransformPreset("circleClose").clipReveal).toEqual({ kind: "circleClose" });
        expect(expandLegacyTransformPreset("wipe", { direction: "right", reverse: true }).clipReveal)
            .toEqual({ kind: "wipe", direction: "right", reverse: true });
    });

    it("expands all twelve displayable effect operations", () => {
        expect(expandLegacyDisplayableEffect("mask", { maskAssetId: "asset-1" }).to).toEqual({ maskAssetId: "asset-1" });
        expect(expandLegacyDisplayableEffect("clearMask", {}).to).toEqual({ maskAssetId: null });
        expect(expandLegacyDisplayableEffect("clip", { clipPath: "circle(40%)" }).to).toEqual({ clipPath: "circle(40%)" });
        expect(expandLegacyDisplayableEffect("clearClip", {}).to).toEqual({ clipPath: null });
        // Parsed where the string permits it, raw where it does not.
        expect(expandLegacyDisplayableEffect("filter", { filter: "blur(4px)" }).to).toEqual({ filter: { blur: 4 } });
        expect(expandLegacyDisplayableEffect("filter", { filter: "blur(5px) brightness(0.75)" }).to).toEqual({ filterRaw: "blur(5px) brightness(0.75)" });
        expect(expandLegacyDisplayableEffect("clearFilter", {}).to).toEqual({ filter: null });
        expect(expandLegacyDisplayableEffect("backdrop", { backdropFilter: "blur(8px)" }).to).toEqual({ backdropFilter: "blur(8px)" });
        expect(expandLegacyDisplayableEffect("blend", { mixBlendMode: "screen" }).to).toEqual({ mixBlendMode: "screen" });
        expect(expandLegacyDisplayableEffect("darken", { darkness: 0.6 }).to).toEqual({ filter: { brightness: 0.4 } });
        expect(expandLegacyDisplayableEffect("circleReveal", { effectProps: { from: 0, to: 150 } }).clipReveal)
            .toEqual({ kind: "circleReveal", fromRadius: 0, toRadius: 150 });
        expect(expandLegacyDisplayableEffect("circleClose", {}).clipReveal).toEqual({ kind: "circleClose" });
        expect(expandLegacyDisplayableEffect("wipe", { effectProps: { direction: "top" } }).clipReveal)
            .toEqual({ kind: "wipe", direction: "top" });
    });
});
