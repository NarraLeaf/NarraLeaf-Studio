import type {
    StoryAlignPositionValue,
    StoryFilterFunction,
    StoryFilterProps,
    StoryTransformProps,
    StoryTransformRef,
} from "@shared/types/story";
import { neutralStoryTransformProps, STORY_FILTER_FUNCTION_ORDER } from "@shared/story/transformProps";
import { legacyPresetPosition } from "@shared/story/transformLegacy";
import { formatStorySecondsValue, storySecondsToMs } from "@shared/utils/storyTime";
import { formatStoryBezierEasing, isStoryBezierEasing, storyBezierPoints } from "@shared/utils/storyEasing";
import { STORY_CAMERA_LOOK_PRESETS } from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import type { StoryCommandEnumFreeform, StoryCommandEnumOption, StoryCommandParamType } from "../storyCommandGrammar";
import type { StoryCommandValue } from "../storyCommandValues";
import {
    asColor,
    asDurationMs,
    asEnum,
    asNumber,
    asText,
    PLACEMENT_OPTIONS,
    SECONDS_TYPE,
    secondsParam,
    type StoryCommandParamSpec,
    type StoryCommandParamsShape,
} from "./spec";

/**
 * **The prop vocabulary**: every channel of {@link StoryTransformProps}, as words an author types.
 *
 * The axiom this file exists to hold: *one prop bag, one interpolation*. A command differs from
 * another only in what it addresses and how its values are spelled - never in what it can reach. So
 * there is one table here, `/transform` writes it, `/reset` clears it, and the row projection reads
 * it back. A channel added to the bag becomes a NAME here and nothing else: no operation, no switch
 * arm, no catalogue entry per surface.
 *
 * That is the whole point of the filter sugar below, and it is worth naming. Before v18 a new filter
 * function cost a `displayable` operation, an arm in the compiler's switch, a payload field, an
 * inspector control and three catalogue entries - which is why in practice none were ever added and
 * `darken` was the only one an author could reach. Now `blur=4 gray=1` is one row carrying the one
 * structured record `{blur: 4, grayscale: 1}`, and the next function is one line in
 * {@link FILTER_SUGAR}.
 *
 * ## What the values are
 *
 * Only three shapes, and they are the shapes the bag already has: a number, a word from a closed
 * list, or a project reference (the mask image). Nothing here invents a syntax - the one exception is
 * `from=`, which is documented at {@link parseFromProps} and reuses the parser's own quoting rather
 * than adding a grouping construct to the grammar.
 */

// ---------------------------------------------------------------------------------------------
// Filter sugar: several names, one record
// ---------------------------------------------------------------------------------------------

/**
 * One name per CSS filter function, with the range a value may sensibly take.
 *
 * The names are short on purpose: these are the props an author reaches for while writing a scene,
 * and `bright=0.6` is typed where `brightness=0.6` is avoided. The canonical filter function keeps
 * its full name in the document, where nothing is typing it.
 *
 * `max` is set only where the function has a real ceiling: `grayscale`, `sepia` and `invert` are
 * proportions and 1 is total, while `saturate` and `contrast` are multipliers with no top. Guessing a
 * ceiling for those would refuse a legal value at the parser, which is the one place a wrong answer
 * cannot be argued with.
 */
type FilterSugarEntry = { fn: StoryFilterFunction; hint: string; min?: number; max?: number };

const FILTER_SUGAR = {
    blur: { fn: "blur", hint: "filterBlur", min: 0 },
    bright: { fn: "brightness", hint: "filterBrightness", min: 0 },
    contrast: { fn: "contrast", hint: "filterContrast", min: 0 },
    gray: { fn: "grayscale", hint: "filterGrayscale", min: 0, max: 1 },
    sat: { fn: "saturate", hint: "filterSaturate", min: 0 },
    sepia: { fn: "sepia", hint: "filterSepia", min: 0, max: 1 },
    hue: { fn: "hueRotate", hint: "filterHue" },
    invert: { fn: "invert", hint: "filterInvert", min: 0, max: 1 },
} as const satisfies Record<string, FilterSugarEntry>;

export type FilterSugarKey = keyof typeof FILTER_SUGAR;

export const FILTER_SUGAR_KEYS = Object.keys(FILTER_SUGAR) as readonly FilterSugarKey[];

/** The sugar name a filter function answers to - the inverse of the table, for the row projection. */
const SUGAR_BY_FUNCTION = new Map<StoryFilterFunction, FilterSugarKey>(
    FILTER_SUGAR_KEYS.map(key => [FILTER_SUGAR[key].fn, key]),
);

// ---------------------------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------------------------

/** Which way a sprite faces. Absolute, never a toggle: a compiled transform cannot read the scale it would invert. */
const FLIP_STATES: readonly StoryCommandEnumOption[] = [{ value: "on" }, { value: "off" }];

/**
 * The CSS `mix-blend-mode` keywords, plus `none` for "back to normal".
 *
 * Spelled as CSS spells them rather than renamed after what they are for: a blend mode is a property
 * of the MATERIAL an author prepared elsewhere (glow rendered on black wants `screen`), and the word
 * on the line has to be the word in the tool that produced it.
 */
const BLEND_MODES: readonly StoryCommandEnumOption[] = [
    "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
    "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
].map(value => ({ value })).concat([{ value: "none" }]);

/**
 * The easing curves the inspector offers, as the `ease=` word list.
 *
 * Derived from nothing - there is no exported table to derive from, `inspectorFieldKit` builds its
 * options inline with a translator - so the values are restated here and `transformVocabulary.test.ts`
 * is what holds the two lists together.
 */
const EASINGS: readonly StoryCommandEnumOption[] = [
    "linear", "easeIn", "easeOut", "easeInOut", "circIn", "circOut", "circInOut",
    "backIn", "backOut", "backInOut", "anticipate",
].map(value => ({ value }));

/**
 * The twelfth easing, which is not a word: the curve the inspector's card draws.
 *
 * `ease=` stays an enum, so a misspelt word is still an error rather than silently stored, and the
 * menu still offers the eleven by name. This is what keeps the line able to SAY what the card can
 * draw - without it, a row carrying a drawn curve printed a value the line refused to take back, and
 * retyping the row dropped the curve.
 *
 * Normalized on the way in, so a curve pasted from a browser's own spelling
 * (`cubic-bezier(.42, 0, .58, 1)`) banks exactly as the card writes it and prints as one token.
 */
const CUSTOM_EASING_CURVE: StoryCommandEnumFreeform = {
    accepts: raw => isStoryBezierEasing(raw),
    normalize: raw => {
        const points = storyBezierPoints(raw);
        return points ? formatStoryBezierEasing(points) : raw;
    },
};

/** The camera look library, as `look=`'s word list. Derived, so the line and the inspector cannot disagree. */
const LOOK_OPTIONS: readonly StoryCommandEnumOption[] = [
    ...STORY_CAMERA_LOOK_PRESETS.map(preset => ({ value: preset.id })),
    { value: "none" },
];

/** `none` on a channel that takes a value: the word that means "back to neutral". */
const NONE_OPTION: StoryCommandParamType = { kind: "enum", options: [{ value: "none" }] };

// ---------------------------------------------------------------------------------------------
// The params
// ---------------------------------------------------------------------------------------------

/** A sugar key's declared range, read through the widened entry shape so an absent bound stays absent. */
function sugarRange(key: FilterSugarKey): { min?: number; max?: number } {
    const entry: FilterSugarEntry = FILTER_SUGAR[key];
    return { ...(entry.min !== undefined ? { min: entry.min } : {}), ...(entry.max !== undefined ? { max: entry.max } : {}) };
}

function numberParam(hint: string, aliases: readonly string[] | undefined, range: { min?: number; max?: number }): StoryCommandParamSpec {
    return { ...(aliases ? { aliases } : {}), hint, type: { kind: "number", ...range } };
}

/**
 * Every prop param, in the order an author types them: where it is, how big, which way up, how it
 * looks, and only then the escape hatches.
 *
 * `pos=` carries three spellings, and they are three READINGS of one channel rather than three
 * behaviours: `at=` is the word every create row already uses, and `pan=` is the word the craft uses
 * when the thing being moved is the camera. A camera that had to be told `pos=` would be the command
 * layer insisting on its own vocabulary over the author's.
 */
export const TRANSFORM_PROP_PARAMS = {
    pos: {
        aliases: ["at", "pan"],
        hint: "placement",
        // A word, or an align pair (`0.2,0.9`). The pair has no closed set to check against, so it
        // rides the text branch and `validate` is what rejects a value that is neither.
        type: [{ kind: "enum", options: PLACEMENT_OPTIONS }, { kind: "text" }] as readonly StoryCommandParamType[],
    },
    zoom: numberParam("zoom", undefined, { min: 0 }),
    scale: numberParam("scale", undefined, { min: 0 }),
    scaleX: numberParam("scaleX", undefined, {}),
    scaleY: numberParam("scaleY", undefined, {}),
    rot: numberParam("rotation", ["rotate"], {}),
    opacity: numberParam("opacity", ["alpha"], { min: 0, max: 1 }),
    // Sugar for `scaleX` ∓1, and it writes NOTHING else. Restating `scaleY` beside it would reset a
    // vertical scale an earlier row set, which is the one thing a mirror must not do.
    flip: { hint: "mirrorState", type: { kind: "enum", options: FLIP_STATES } },
    ...(Object.fromEntries(FILTER_SUGAR_KEYS.map(key => [
        key,
        numberParam(FILTER_SUGAR[key].hint, undefined, sugarRange(key)),
    ])) as { [K in FilterSugarKey]: StoryCommandParamSpec }),
    // A grade off the camera look library. It is filter sugar whose value is a NAME rather than a
    // number, which is what keeps the library reachable now that `/camera` is gone.
    look: { hint: "cameraLook", type: { kind: "enum", options: LOOK_OPTIONS } },
    strength: { aliases: ["intensity"], hint: "cameraLookStrength", type: { kind: "number", min: 0, max: 2 } },
    // The raw escape hatch. Mutually exclusive with the sugar and with `look=`: all three write the
    // one CSS `filter` channel, and two writers of one channel means whichever is read last wins
    // silently - the same fault `/font` refuses a size and a colour for.
    filter: { hint: "filterCss", type: [NONE_OPTION, { kind: "text" }] as readonly StoryCommandParamType[] },
    mask: { hint: "maskImage", type: [NONE_OPTION, { kind: "asset", assetType: "image" }] as readonly StoryCommandParamType[] },
    clip: { hint: "clipPath", type: [NONE_OPTION, { kind: "text" }] as readonly StoryCommandParamType[] },
    backdrop: { hint: "backdropFilter", type: [NONE_OPTION, { kind: "text" }] as readonly StoryCommandParamType[] },
    blend: { hint: "blendMode", type: { kind: "enum", options: BLEND_MODES } },
    // Text targets only - it is `fontColor`, the one channel in the bag that belongs to one kind of
    // displayable. `validate` says so rather than the type, which cannot see what the target is.
    color: { hint: "color", type: { kind: "color" } },
} as const satisfies StoryCommandParamsShape;

/**
 * The timing every prop row shares, plus the two things that are not props at all.
 *
 * `motion` is a FLAG rather than a value because a Story Motion is a binding, not a word: there is no
 * list of them in the command context and no name a line could resolve, exactly as `/camera motion`
 * always had to hand the picking to the inspector. Saying `motion` states which of the ref's two
 * modes the row is in; the shot itself is chosen on the right.
 */
export const TRANSFORM_TIMING_PARAMS = {
    d: secondsParam(),
    ease: { aliases: ["easing"], hint: "easing", type: { kind: "enum", options: EASINGS, freeform: CUSTOM_EASING_CURVE } },
    delay: { hint: "delay", type: SECONDS_TYPE },
    repeat: { hint: "repeat", type: { kind: "number", min: 0, integer: true } },
    repeatDelay: { hint: "repeatDelay", type: SECONDS_TYPE },
    from: { hint: "fromProps", type: { kind: "text" } },
    motion: { hint: "storyMotion", type: { kind: "boolean" } },
} as const satisfies StoryCommandParamsShape;

/** Every key that writes a prop - what `validate` checks against and what a camera row measures itself by. */
export const TRANSFORM_PROP_KEYS = Object.keys(TRANSFORM_PROP_PARAMS) as readonly (keyof typeof TRANSFORM_PROP_PARAMS)[];

export type TransformArgs = Readonly<Record<string, StoryCommandValue | undefined>>;

// ---------------------------------------------------------------------------------------------
// Args -> bag
// ---------------------------------------------------------------------------------------------

/** `left` / `center` / `right`, or an align pair `x,y`. Anything else is not a position. */
export function parsePositionValue(raw: string | undefined): StoryAlignPositionValue | null {
    const text = raw?.trim();
    if (!text) {
        return null;
    }
    const preset = legacyPresetPosition(text, {});
    if (preset) {
        return preset;
    }
    const pair = text.split(",");
    if (pair.length !== 2) {
        return null;
    }
    const [xalign, yalign] = pair.map(part => Number(part.trim()));
    return Number.isFinite(xalign) && Number.isFinite(yalign) ? { xalign, yalign } : null;
}

/** The position a `pos=` arg states, whichever of its two branches the value took. */
function positionOf(value: StoryCommandValue | undefined): StoryAlignPositionValue | null {
    return parsePositionValue(asEnum(value) ?? asText(value));
}

/** A `none` on a channel that takes a value, i.e. "back to neutral" - which the bag spells `null`. */
function clearedOr<T>(value: StoryCommandValue | undefined, read: (value: StoryCommandValue) => T | undefined): T | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (asEnum(value) === "none") {
        return null;
    }
    return read(value);
}

/** Every filter function the sugar keys state, composed into the one structured record. */
function filterSugarRecord(args: TransformArgs): StoryFilterProps | undefined {
    const record: StoryFilterProps = {};
    for (const key of FILTER_SUGAR_KEYS) {
        const amount = asNumber(args[key]);
        if (amount !== undefined) {
            record[FILTER_SUGAR[key].fn] = amount;
        }
    }
    return Object.keys(record).length > 0 ? record : undefined;
}

/** Which of the three writers of the CSS filter channel this row used. At most one may be present. */
export type FilterWriter = "sugar" | "raw" | "look";

export function filterWritersOf(args: TransformArgs): readonly FilterWriter[] {
    const writers: FilterWriter[] = [];
    if (FILTER_SUGAR_KEYS.some(key => asNumber(args[key]) !== undefined)) {
        writers.push("sugar");
    }
    if (args.filter !== undefined) {
        writers.push("raw");
    }
    if (args.look !== undefined) {
        writers.push("look");
    }
    return writers;
}

/**
 * The prop bag a line states.
 *
 * Only the channels the row actually names: an absent key is `undefined`, which the bag reads as
 * "leave this as it stands", and that is what lets two rows compose instead of the second one
 * silently resetting whatever the first did.
 *
 * `look=` is resolved to its CSS here rather than kept as a name, because a displayable has nowhere
 * to keep the name - `lookPreset` is a field of the CAMERA payload. A camera row reads the same arg
 * again through {@link cameraLookOf} and keeps the preset, so the inspector can re-open on the grade
 * the author chose instead of on a wall of CSS.
 */
export function transformPropsFromArgs(
    args: TransformArgs,
    resolveLook: (presetId: string, intensity: number | undefined) => string | null,
): StoryTransformProps {
    const props: StoryTransformProps = {};
    const position = positionOf(args.pos);
    if (position) {
        props.position = position;
    }
    const zoom = asNumber(args.zoom);
    if (zoom !== undefined) {
        props.zoom = zoom;
    }
    // `scale=` writes both axes; a `scaleX=` / `scaleY=` beside it is the more specific instruction
    // and lands second, so `/transform hero scale=2 scaleY=1` is a legal way to stretch one axis.
    const scale = asNumber(args.scale);
    if (scale !== undefined) {
        props.scaleX = scale;
        props.scaleY = scale;
    }
    const flip = asEnum(args.flip);
    if (flip !== undefined) {
        props.scaleX = flip === "off" ? 1 : -1;
    }
    const scaleX = asNumber(args.scaleX);
    if (scaleX !== undefined) {
        props.scaleX = scaleX;
    }
    const scaleY = asNumber(args.scaleY);
    if (scaleY !== undefined) {
        props.scaleY = scaleY;
    }
    const rotation = asNumber(args.rot);
    if (rotation !== undefined) {
        props.rotation = rotation;
    }
    const opacity = asNumber(args.opacity);
    if (opacity !== undefined) {
        props.opacity = opacity;
    }
    const maskAssetId = clearedOr(args.mask, value => (value.kind === "asset" ? value.assetId : undefined));
    if (maskAssetId === null) {
        // `mask=none` clears the whole mask, not just its image: a `maskSize` left behind describes a
        // mask that is no longer there, and the four settings have no meaning without one. This is
        // also what makes `/reset hero mask` and `/transform hero mask=none` the same row.
        Object.assign(props, RESET_CHANNELS.mask);
    } else if (maskAssetId !== undefined) {
        props.maskAssetId = maskAssetId;
    }
    const clipPath = clearedOr(args.clip, asText);
    if (clipPath !== undefined) {
        props.clipPath = clipPath;
    }
    const backdropFilter = clearedOr(args.backdrop, asText);
    if (backdropFilter !== undefined) {
        props.backdropFilter = backdropFilter;
    }
    const blend = asEnum(args.blend);
    if (blend !== undefined) {
        props.mixBlendMode = blend === "none" ? null : blend;
    }
    const color = asColor(args.color);
    if (color !== undefined) {
        props.fontColor = color;
    }
    // The one channel three keys write. They are already refused together by `validate`, so at most
    // one of these three branches can be reached by a line that resolves.
    const sugar = filterSugarRecord(args);
    if (sugar) {
        props.filter = sugar;
    }
    const raw = clearedOr(args.filter, asText);
    if (raw !== undefined) {
        props.filterRaw = raw;
    }
    const look = asEnum(args.look);
    if (look === "none") {
        props.filter = null;
    } else if (look !== undefined) {
        props.filterRaw = resolveLook(look, asNumber(args.strength));
    }
    return props;
}

/** The grade a camera row keeps by NAME, so the inspector can re-open on it. `null` when the row names none. */
export function cameraLookOf(args: TransformArgs): { lookPreset?: string; lookIntensity?: number } | null {
    const look = asEnum(args.look);
    if (look === undefined || look === "none") {
        return null;
    }
    const intensity = asNumber(args.strength);
    return { lookPreset: look, ...(intensity !== undefined ? { lookIntensity: intensity } : {}) };
}

/**
 * `from=` - where the move starts, as a quoted prop list: `from="zoom=1.4 opacity=0"`.
 *
 * **Why a quoted string rather than a new grouping syntax.** The parser has exactly one grouping
 * construct - a quote - and it already keeps everything inside one token, `=` included
 * (`firstUnquotedEquals`). So this spelling needs no grammar change, no new token kind, and no second
 * way to write a prop; it round-trips through the tokenizer unchanged, and the row prints back what
 * the author typed. Inventing `from(zoom=1.4)` would have added a bracket the lexer must learn, and
 * that bracket would then exist for every other value in the language.
 *
 * **Only the continuous channels.** A `from` is the start of an INTERPOLATION, and the discrete
 * channels do not interpolate - `splitStoryTransformChange` cuts every one of them, so a start value
 * for a mask or a blend mode would be a value nothing could ever read. What is left is exactly the
 * set that needs no project lookup (numbers and the three placement words), which is why this can be
 * a plain re-parse rather than a second pass through resolution.
 */
export function parseFromProps(source: string | undefined): { props: StoryTransformProps; badKeys: readonly string[] } {
    const props: StoryTransformProps = {};
    const badKeys: string[] = [];
    for (const entry of (source ?? "").split(/\s+/)) {
        if (!entry) {
            continue;
        }
        const split = entry.indexOf("=");
        const key = (split === -1 ? entry : entry.slice(0, split)).trim().toLowerCase();
        const raw = split === -1 ? "" : entry.slice(split + 1).trim();
        const amount = Number(raw);
        const sugar = FILTER_SUGAR_KEYS.find(name => name === key);
        if (sugar && Number.isFinite(amount)) {
            props.filter = { ...(props.filter ?? {}), [FILTER_SUGAR[sugar].fn]: amount };
            continue;
        }
        if (key === "pos" || key === "at" || key === "pan") {
            const position = parsePositionValue(raw);
            position ? (props.position = position) : badKeys.push(entry);
            continue;
        }
        if (!Number.isFinite(amount)) {
            badKeys.push(entry);
            continue;
        }
        switch (key) {
            case "zoom": props.zoom = amount; break;
            case "scale": props.scaleX = amount; props.scaleY = amount; break;
            case "scalex": props.scaleX = amount; break;
            case "scaley": props.scaleY = amount; break;
            case "rot": case "rotate": props.rotation = amount; break;
            case "opacity": case "alpha": props.opacity = amount; break;
            default: badKeys.push(entry); break;
        }
    }
    return { props, badKeys };
}

/** The timing half of the ref: everything that is about WHEN rather than about where it ends up. */
export function transformTimingFromArgs(args: TransformArgs): Partial<StoryTransformRef> {
    const ref: Partial<StoryTransformRef> = {};
    const durationMs = asDurationMs(args.d);
    if (durationMs !== undefined) {
        ref.durationMs = durationMs;
    }
    const easing = asEnum(args.ease);
    if (easing !== undefined) {
        ref.easing = easing;
    }
    const delayMs = asDurationMs(args.delay);
    if (delayMs !== undefined) {
        ref.delayMs = delayMs;
    }
    const repeat = asNumber(args.repeat);
    if (repeat !== undefined) {
        ref.repeat = repeat;
    }
    const repeatDelayMs = asDurationMs(args.repeatDelay);
    if (repeatDelayMs !== undefined) {
        ref.repeatDelayMs = repeatDelayMs;
    }
    const from = parseFromProps(asText(args.from)).props;
    if (Object.keys(from).length > 0) {
        ref.from = from;
    }
    return ref;
}

// ---------------------------------------------------------------------------------------------
// `/reset`
// ---------------------------------------------------------------------------------------------

/**
 * What each `/reset` flag puts back, as the bag fragment it writes.
 *
 * This IS what `clearMask` / `clearClip` / `clearFilter` were, and it is why v18 made the appearance
 * channels nullable: `undefined` means "leave it" and could never have spelled "put it back".
 *
 * `color` has no entry, and that is a statement rather than an omission: `fontColor` is the one
 * channel with no neutral (see `neutralStoryTransformProps`), so there is nothing for a reset to
 * write. A text's colour is changed by naming the next one.
 */
const RESET_CHANNELS = {
    pos: { position: { xalign: 0.5, yalign: 0.5 } },
    zoom: { zoom: 1 },
    scale: { scaleX: 1, scaleY: 1 },
    scaleX: { scaleX: 1 },
    scaleY: { scaleY: 1 },
    rot: { rotation: 0 },
    opacity: { opacity: 1 },
    filter: { filter: null },
    mask: { maskAssetId: null, maskSize: null, maskPosition: null, maskRepeat: null, maskMode: null },
    clip: { clipPath: null },
    backdrop: { backdropFilter: null },
    blend: { mixBlendMode: null },
} as const satisfies Record<string, StoryTransformProps>;

export type ResetChannelKey = keyof typeof RESET_CHANNELS;

export const RESET_CHANNEL_KEYS = Object.keys(RESET_CHANNELS) as readonly ResetChannelKey[];

/** `/reset`'s named props, as bare flags: `/reset hero mask filter` reads as two keys, not two words. */
export const RESET_PROP_PARAMS = Object.fromEntries(
    RESET_CHANNEL_KEYS.map(key => [key, { hint: TRANSFORM_PROP_PARAMS[key].hint, type: { kind: "boolean" } }]),
) as { [K in ResetChannelKey]: StoryCommandParamSpec };

/**
 * The bag a `/reset` writes: the named channels, or - when the line names none - the whole neutral.
 *
 * "No props" meaning "all of them" is the reading that matches the word: `/reset hero` is the sentence
 * an author writes to undo everything, and a reset that quietly did nothing because no channel was
 * named would be the most surprising row in the language.
 */
export function resetPropsFromArgs(args: TransformArgs): StoryTransformProps {
    const named = RESET_CHANNEL_KEYS.filter(key => args[key]?.kind === "boolean" && args[key]?.value !== false);
    if (named.length === 0) {
        return neutralStoryTransformProps();
    }
    return named.reduce<StoryTransformProps>((props, key) => ({ ...props, ...RESET_CHANNELS[key] }), {});
}

// ---------------------------------------------------------------------------------------------
// Bag -> args (the row projection's half)
// ---------------------------------------------------------------------------------------------

export type TransformPropArg = { key: string; value: string; enum?: boolean };

function numberWord(value: number | undefined): string | undefined {
    return value === undefined ? undefined : String(Number(value.toFixed(4)));
}

/** The three placement words, or the align pair - the inverse of {@link parsePositionValue}. */
function positionWord(position: StoryAlignPositionValue | undefined): string | undefined {
    if (!position) {
        return undefined;
    }
    if (position.xoffset === undefined && position.yoffset === undefined && position.yalign === 0.5) {
        for (const word of ["left", "center", "right"] as const) {
            if (legacyPresetPosition(word, {})?.xalign === position.xalign) {
                return word;
            }
        }
    }
    // An offset has no spelling in the vocabulary, so a bag carrying one prints nothing rather than
    // an align pair that would silently drop it on the way back in.
    if (position.xoffset !== undefined || position.yoffset !== undefined) {
        return undefined;
    }
    return `${numberWord(position.xalign)},${numberWord(position.yalign)}`;
}

/**
 * A stored bag as the props an author would have typed for it.
 *
 * The exact inverse of {@link transformPropsFromArgs} on everything a line can spell, and silent on
 * everything it cannot (an offset position, a mask whose asset is gone, a `maskSize`) - a row may
 * only ever show a line the author could type back, so a channel with no spelling prints nothing and
 * stays the inspector's.
 */
export function transformPropArgs(
    props: StoryTransformProps | undefined,
    assetName: (assetId: string) => string | undefined,
): readonly TransformPropArg[] {
    if (!props) {
        return [];
    }
    const args: TransformPropArg[] = [];
    const push = (key: string, value: string | undefined, isEnum?: boolean) => {
        if (value !== undefined) {
            args.push({ key, value, ...(isEnum ? { enum: true } : {}) });
        }
    };
    push("pos", positionWord(props.position), true);
    push("zoom", numberWord(props.zoom));
    // A mirror is a `scaleX` of ∓1 with no vertical scale beside it, and it reads back as the word
    // that produced it rather than as the number - `flip=on` is what the author typed and what the
    // retired `/mirror` row now says.
    if ((props.scaleX === 1 || props.scaleX === -1) && props.scaleY === undefined) {
        push("flip", props.scaleX === -1 ? "on" : "off", true);
    } else if (props.scaleX !== undefined && props.scaleX === props.scaleY) {
        push("scale", numberWord(props.scaleX));
    } else {
        push("scaleX", numberWord(props.scaleX));
        push("scaleY", numberWord(props.scaleY));
    }
    push("rot", numberWord(props.rotation));
    push("opacity", numberWord(props.opacity));
    // In the chain's canonical order, never the record's insertion order: the row's text is a value
    // an author reads and a diff compares, and two bags that mean the same thing must print the same
    // line. `composeStoryFilter` fixes the same order for the same reason.
    for (const fn of STORY_FILTER_FUNCTION_ORDER) {
        push(SUGAR_BY_FUNCTION.get(fn) ?? fn, numberWord(props.filter?.[fn]));
    }
    if (props.filter === null) {
        push("filter", "none", true);
    }
    if (props.filterRaw !== undefined) {
        push("filter", props.filterRaw === null ? "none" : props.filterRaw, props.filterRaw === null);
    }
    if (props.maskAssetId !== undefined) {
        push("mask", props.maskAssetId === null ? "none" : assetName(props.maskAssetId), props.maskAssetId === null);
    }
    if (props.clipPath !== undefined) {
        push("clip", props.clipPath === null ? "none" : props.clipPath, props.clipPath === null);
    }
    if (props.backdropFilter !== undefined) {
        push("backdrop", props.backdropFilter === null ? "none" : props.backdropFilter, props.backdropFilter === null);
    }
    if (props.mixBlendMode !== undefined) {
        push("blend", props.mixBlendMode ?? "none", true);
    }
    push("color", props.fontColor);
    return args;
}

/** A `from=` bag as the quoted list that would produce it, or nothing when it states none. */
export function fromPropsWord(props: StoryTransformProps | undefined): string | undefined {
    const args = transformPropArgs(props, () => undefined)
        .filter(arg => ["pos", "zoom", "scale", "scaleX", "scaleY", "rot", "opacity", ...FILTER_SUGAR_KEYS].includes(arg.key as FilterSugarKey));
    return args.length === 0 ? undefined : args.map(arg => `${arg.key}=${arg.value}`).join(" ");
}

/** The timing half, read back. Seconds as the author types them, so `300ms` prints `0.3`. */
export function transformTimingArgs(ref: StoryTransformRef | undefined): readonly TransformPropArg[] {
    if (!ref) {
        return [];
    }
    const args: TransformPropArg[] = [];
    const seconds = (ms: number | undefined) => (ms === undefined ? undefined : formatStorySecondsValue(ms));
    const push = (key: string, value: string | undefined, isEnum?: boolean) => {
        if (value !== undefined && value !== "") {
            args.push({ key, value, ...(isEnum ? { enum: true } : {}) });
        }
    };
    push("d", seconds(ref.durationMs));
    push("ease", ref.easing, true);
    push("delay", seconds(ref.delayMs));
    push("repeat", numberWord(ref.repeat));
    push("repeatDelay", seconds(ref.repeatDelayMs));
    push("from", fromPropsWord(ref.from));
    return args;
}

/** Author-typed seconds into the milliseconds a ref stores - the one conversion these params share. */
export function transformSecondsToMs(next: string): number {
    return storySecondsToMs(Number(next));
}

/**
 * Write one prop back into a bag - what a click-to-edit on a committed row applies.
 *
 * A writer, not a rebuild: it patches the single channel the printed value came from and leaves
 * everything else alone. Rebuilding the bag from the line would silently drop every channel the line
 * cannot spell - an offset position, a `maskSize`, a `from` bag - which is the failure the row
 * projection's `apply` contract exists to prevent.
 *
 * `mask` has no arm and prints without an editor: its value on the line is the asset's NAME while the
 * bag stores an id, so an edit here would have to resolve a name against a library this layer cannot
 * see. The asset picker on the right is where that belongs.
 */
export function patchTransformProp(props: StoryTransformProps | undefined, key: string, next: string): StoryTransformProps {
    const bag: StoryTransformProps = { ...(props ?? {}) };
    const amount = Number(next);
    const sugar = FILTER_SUGAR_KEYS.find(name => name === key);
    if (sugar) {
        return { ...bag, filter: { ...(bag.filter ?? {}), [FILTER_SUGAR[sugar].fn]: amount } };
    }
    switch (key) {
        case "pos": return { ...bag, position: parsePositionValue(next) ?? bag.position };
        case "zoom": return { ...bag, zoom: amount };
        case "scale": return { ...bag, scaleX: amount, scaleY: amount };
        case "scaleX": return { ...bag, scaleX: amount };
        case "scaleY": return { ...bag, scaleY: amount };
        case "rot": return { ...bag, rotation: amount };
        case "opacity": return { ...bag, opacity: amount };
        // Absolute, never a toggle - the same reason the retired `/mirror` never took one: a compiled
        // transform cannot read the scale it would have to invert.
        case "flip": return { ...bag, scaleX: next === "on" ? -1 : 1 };
        case "filter": return next === "none" ? { ...bag, filter: null, filterRaw: undefined } : { ...bag, filterRaw: next, filter: undefined };
        case "clip": return { ...bag, clipPath: next === "none" ? null : next };
        case "backdrop": return { ...bag, backdropFilter: next === "none" ? null : next };
        case "blend": return { ...bag, mixBlendMode: next === "none" ? null : next };
        case "color": return { ...bag, fontColor: next };
        default: return bag;
    }
}

/** The same, for the timing half. `from=` is absent for the reason `mask` is: it is a bag, not a value. */
export function patchTransformTiming(ref: StoryTransformRef | undefined, key: string, next: string): StoryTransformRef {
    const base: StoryTransformRef = { ...(ref ?? {}) };
    switch (key) {
        case "d": return { ...base, durationMs: transformSecondsToMs(next) };
        case "ease": return { ...base, easing: next };
        case "delay": return { ...base, delayMs: transformSecondsToMs(next) };
        case "repeat": return { ...base, repeat: Number(next) };
        case "repeatDelay": return { ...base, repeatDelayMs: transformSecondsToMs(next) };
        default: return base;
    }
}
