import { describe, expect, it } from "vitest";
import { neutralStoryTransformProps } from "@shared/story/transformProps";
import { paramTypes } from "../storyCommandGrammar";
import { getCommandDef } from "./registry";
import {
    FILTER_SUGAR_KEYS,
    fromPropsWord,
    parseFromProps,
    parsePositionValue,
    patchTransformProp,
    RESET_CHANNEL_KEYS,
    resetPropsFromArgs,
    transformPropArgs,
    transformTimingArgs,
} from "./transformVocabulary";

/**
 * The prop vocabulary's own invariants — the ones no command spec can hold on its own.
 *
 * All three are about a PAIR staying honest: what a line writes against what a row prints, what this
 * table offers against what the inspector offers, and what `from=` takes against what it can print.
 */

/** The `ease=` word list, restated from `inspectorFieldKit`'s options (which are built with a translator). */
const INSPECTOR_EASINGS = [
    "linear", "easeIn", "easeOut", "easeInOut", "circIn", "circOut", "circInOut",
    "backIn", "backOut", "backInOut", "anticipate",
];

describe("the prop vocabulary", () => {
    it("offers exactly the easings the property inspector does", () => {
        // Two surfaces, one setting. An easing an author can pick on the right and cannot type on the
        // left is a row that prints a value the line will not take back — the split this milestone
        // exists to close, in miniature.
        const ease = getCommandDef("transform")!.params.find(param => param.name === "ease")!;
        const type = paramTypes(ease).find(candidate => candidate.kind === "enum");
        expect(type?.kind === "enum" && type.options.map(option => option.value)).toEqual(INSPECTOR_EASINGS);
    });

    it("composes several filter names into the one structured record, and reads them back", () => {
        // The single most important ergonomic in the redesign: a new filter function is a new NAME
        // here and nothing else — no operation, no switch arm, no inspector field, no catalogue row
        // per surface. The round trip is what proves the name is the whole cost.
        const props = { filter: { blur: 4, grayscale: 1 } };
        expect(transformPropArgs(props, () => undefined)).toEqual([
            { key: "gray", value: "1" },
            { key: "blur", value: "4" },
        ]);
        for (const key of FILTER_SUGAR_KEYS) {
            const written = patchTransformProp({}, key, "0.5");
            expect(Object.keys(written.filter ?? {}), key).toHaveLength(1);
        }
    });

    it("prints a mirror as the word that wrote it, and a real scale as a number", () => {
        // A mirror is `scaleX` ∓1 with no vertical scale beside it. Restating `scaleY` would reset a
        // vertical scale an earlier row set, which is the one thing a mirror must not do.
        expect(transformPropArgs({ scaleX: -1 }, () => undefined)).toEqual([{ key: "flip", value: "on", enum: true }]);
        expect(transformPropArgs({ scaleX: 1 }, () => undefined)).toEqual([{ key: "flip", value: "off", enum: true }]);
        expect(transformPropArgs({ scaleX: 2, scaleY: 2 }, () => undefined)).toEqual([{ key: "scale", value: "2" }]);
        expect(transformPropArgs({ scaleX: -1, scaleY: 0.5 }, () => undefined))
            .toEqual([{ key: "scaleX", value: "-1" }, { key: "scaleY", value: "0.5" }]);
    });

    it("prints nothing for a channel no line can spell", () => {
        // A row may only ever show a line the author could type back, so an offset position and a
        // mask whose asset is gone print nothing and stay the inspector's.
        expect(transformPropArgs({ position: { xalign: 0.5, yalign: 0.5, xoffset: 20 } }, () => undefined)).toEqual([]);
        expect(transformPropArgs({ maskAssetId: "gone" }, () => undefined)).toEqual([{ key: "mask", value: undefined }]
            .filter(entry => entry.value !== undefined));
    });

    it("reads a placement word or an align pair, and nothing else", () => {
        expect(parsePositionValue("left")).toMatchObject({ xalign: 0.25 });
        expect(parsePositionValue("0.2,0.9")).toEqual({ xalign: 0.2, yalign: 0.9 });
        expect(parsePositionValue("somewhere")).toBeNull();
        expect(parsePositionValue("0.2")).toBeNull();
    });

    it("takes `from=` as a quoted prop list, and only the channels that interpolate", () => {
        // The one grouping construct the parser already has is a quote, and it keeps `=` inside one
        // token — so this spelling needs no grammar change and round-trips through the tokenizer.
        const { props, badKeys } = parseFromProps("zoom=1.4 opacity=0 blur=8 pos=left");
        expect(props).toMatchObject({ zoom: 1.4, opacity: 0, filter: { blur: 8 } });
        expect(props.position).toMatchObject({ xalign: 0.25 });
        expect(badKeys).toEqual([]);
        // A discrete channel does not interpolate — `splitStoryTransformChange` cuts every one of
        // them — so a start value for one would be a value nothing could ever read.
        expect(parseFromProps("mask=forest blend=screen").badKeys).toEqual(["mask=forest", "blend=screen"]);
        expect(fromPropsWord({ zoom: 1.4, opacity: 0 })).toBe("zoom=1.4 opacity=0");
    });

    it("names a reset channel for every channel the neutral bag states", () => {
        // `/reset hero mask` has to be able to clear what `/reset hero` clears, or the named form is a
        // strict subset of the whole one for reasons nobody could explain. `fontColor` is the one
        // documented absence: it has no neutral, so neither form writes it.
        const neutral = Object.keys(neutralStoryTransformProps());
        const named = new Set(RESET_CHANNEL_KEYS.flatMap(key => Object.keys(patchedFor(key))));
        for (const channel of neutral) {
            expect(named, `${channel} has no /reset flag`).toContain(channel);
        }
        expect(neutral).not.toContain("fontColor");
    });

    it("round-trips the timing half in the seconds an author types", () => {
        expect(transformTimingArgs({ durationMs: 400, delayMs: 200, repeat: 2, repeatDelayMs: 100, easing: "easeInOut" }))
            .toEqual([
                { key: "d", value: "0.4" },
                { key: "ease", value: "easeInOut", enum: true },
                { key: "delay", value: "0.2" },
                { key: "repeat", value: "2" },
                { key: "repeatDelay", value: "0.1" },
            ]);
    });
});

/** The bag one `/reset` flag writes. */
function patchedFor(key: string): Record<string, unknown> {
    return resetPropsFromArgs({ [key]: { kind: "boolean", value: true } }) as Record<string, unknown>;
}
