import type {
    StoryAlignPositionValue,
    StoryFilterFunction,
    StoryFilterProps,
    StoryTransformProps,
    StoryTransformRef,
} from "@shared/types/story";
import type { TranslationKey, Translator } from "@shared/i18n";
import { STORY_CAMERA_LOOK_DEFAULT_PRESET_ID } from "@/lib/ui-editor/runtime/game/cameraLookPresets";

/**
 * The transform bag, as a list of channels an author adds and removes one at a time.
 *
 * **What this replaces.** The inspector used to ask "which effect is this row" - one dropdown, one
 * answer, one editor. That question stopped having an answer at v18: a row states a BAG, and
 * `/transform hero pos=left blur=4` states two channels at once. The old surface read the bag, took
 * the first appearance channel it found and drew only that one, so the position on such a row was
 * not editable at all and eight of the filter functions had no control anywhere.
 *
 * So the model here is the bag itself. A channel is stated or it is not; several are stated at once;
 * each one knows how to seed itself, how to leave, and what it cannot share a row with. Nothing here
 * renders - the controls live in `TransformChannelEditor.tsx`, and this half is what the tests hold.
 *
 * **The vocabulary is the command line's.** Every channel below is a param of
 * `TRANSFORM_PROP_PARAMS` / `TRANSFORM_TIMING_PARAMS`, so a look an author can type is a look they
 * can also find on the right.
 */

export type TransformChannelGroupId = "geometry" | "filter" | "look" | "composite" | "text" | "timing";

export const TRANSFORM_CHANNEL_GROUPS: readonly TransformChannelGroupId[] = [
    "geometry", "filter", "look", "composite", "text", "timing",
];

/**
 * The eight filter functions the line spells as sugar, in the order it lists them.
 *
 * `opacity` is a CSS filter function too and is deliberately absent: the bag already has a geometry
 * `opacity`, and offering both would be two controls writing what an author reads as one word.
 */
export const FILTER_CHANNEL_FUNCTIONS: readonly StoryFilterFunction[] = [
    "blur", "brightness", "contrast", "grayscale", "saturate", "sepia", "hueRotate", "invert",
];

/** The neutral value of each function - what a fresh channel must seed, so adding one edits nothing. */
const FILTER_NEUTRAL: Record<StoryFilterFunction, number> = {
    blur: 0,
    brightness: 1,
    contrast: 1,
    grayscale: 0,
    saturate: 1,
    sepia: 0,
    hueRotate: 0,
    invert: 0,
    opacity: 1,
};

export type TransformChannelId = string;

/**
 * A slot two channels cannot both occupy.
 *
 * `cssFilter` is the load-bearing one: the structured record, a hand-written chain and a grade from
 * the look library are three writers of the single CSS filter channel, and two of them on one row
 * means whichever the emitter reads last wins with no diagnostic anywhere. The command line refuses
 * the combination outright (`filterWritersOf`); the picker refuses it by not offering the second.
 *
 * Each discrete channel takes a slot of its own so that "mask" and "restore mask" - the same field
 * holding a value and holding `null` - are one occupancy rather than two rows contradicting.
 */
type ChannelSlot = "cssFilter" | "mask" | "clip" | "backdrop" | "blend";

/** Just the translate call, so this module needs nothing from the rendering half. */
export type ChannelTranslate = Translator["t"];

export type TransformChannelSpec = {
    id: TransformChannelId;
    group: TransformChannelGroupId;
    /**
     * The word the row and the picker read.
     *
     * Taken from `story.paramHint.*` - the command line's own vocabulary - rather than from a second
     * table under `storyInspector`. A channel an author can type as `blur=4` has to be the same word
     * on the right, and the only way to guarantee that is for there to be one word.
     */
    label: (t: ChannelTranslate) => string;
    /** Does the ref state this channel. */
    stated: (ref: StoryTransformRef) => boolean;
    /** Land it on the value that changes nothing, so adding a channel is never a silent edit. */
    add: (ref: StoryTransformRef) => StoryTransformRef;
    /** Take it out of the bag - not set it to neutral. The two are different instructions. */
    remove: (ref: StoryTransformRef) => StoryTransformRef;
    slot?: ChannelSlot;
    /** Several may share the slot - the eight filter functions compose into one record. */
    shares?: boolean;
    /** Only offered when the row's target is a text object; `fontColor` is the one such channel. */
    textOnly?: boolean;
};

// ---------------------------------------------------------------------------------------------
// Bag helpers
// ---------------------------------------------------------------------------------------------

function propsOf(ref: StoryTransformRef): StoryTransformProps {
    return ref.to ?? {};
}

export function withTransformProps(ref: StoryTransformRef, patch: Partial<StoryTransformProps>): StoryTransformRef {
    const to: StoryTransformProps = { ...propsOf(ref), ...patch };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            delete to[key as keyof StoryTransformProps];
        }
    }
    return { ...ref, mode: "props", to };
}

export function withoutTransformProps(
    ref: StoryTransformRef,
    keys: readonly (keyof StoryTransformProps)[],
): StoryTransformRef {
    const to: StoryTransformProps = { ...propsOf(ref) };
    for (const key of keys) {
        delete to[key];
    }
    const next: StoryTransformRef = { ...ref, mode: "props", to };
    if (Object.keys(to).length === 0) {
        delete next.to;
    }
    return next;
}

/** The structured record, or `undefined` when the row has none - `null` is "restore", not a record. */
export function filterRecordOf(ref: StoryTransformRef): StoryFilterProps | undefined {
    return propsOf(ref).filter ?? undefined;
}

export function withFilterFunction(ref: StoryTransformRef, fn: StoryFilterFunction, value: number): StoryTransformRef {
    return withTransformProps(ref, {
        filter: { ...(filterRecordOf(ref) ?? {}), [fn]: value },
        filterRaw: undefined,
        look: undefined,
    });
}

function withoutFilterFunction(ref: StoryTransformRef, fn: StoryFilterFunction): StoryTransformRef {
    const record: StoryFilterProps = { ...(filterRecordOf(ref) ?? {}) };
    delete record[fn];
    return Object.keys(record).length > 0
        ? withTransformProps(ref, { filter: record })
        : withoutTransformProps(ref, ["filter"]);
}

/** Every key `mask=none` clears - the image, and the four settings that only describe one. */
const MASK_KEYS = ["maskAssetId", "maskSize", "maskPosition", "maskRepeat", "maskMode"] as const;

// ---------------------------------------------------------------------------------------------
// The grade library, read backwards
// ---------------------------------------------------------------------------------------------

/**
 * The range the intensity control offers, which is the library's own.
 *
 * There used to be an INDEX here: every preset built at every step of this grid, so a grade stored as
 * expanded CSS could be matched back to the name that produced it. It existed because a displayable
 * had nowhere to keep the name - and the bag holds one now (`StoryTransformProps.look`), so the whole
 * reverse lookup is gone rather than merely unused.
 */
export const LOOK_INTENSITY_STEP = 0.05;
export const LOOK_INTENSITY_MAX = 2;

export function roundLookIntensity(intensity: number): number {
    return Number(intensity.toFixed(2));
}

// ---------------------------------------------------------------------------------------------
// The channels
// ---------------------------------------------------------------------------------------------

function numberChannel(
    key: "zoom" | "scaleX" | "scaleY" | "rotation" | "opacity",
    seed: number,
): TransformChannelSpec {
    return {
        id: key,
        group: "geometry",
        label: t => t(`story.paramHint.${key}` as TranslationKey),
        stated: ref => propsOf(ref)[key] !== undefined,
        add: ref => withTransformProps(ref, { [key]: seed }),
        remove: ref => withoutTransformProps(ref, [key]),
    };
}

/** The sugar key each function answers to on the line, which is where its word lives. */
const FILTER_HINT_KEY: Partial<Record<StoryFilterFunction, TranslationKey>> = {
    blur: "story.paramHint.filterBlur",
    brightness: "story.paramHint.filterBrightness",
    contrast: "story.paramHint.filterContrast",
    grayscale: "story.paramHint.filterGrayscale",
    saturate: "story.paramHint.filterSaturate",
    sepia: "story.paramHint.filterSepia",
    hueRotate: "story.paramHint.filterHue",
    invert: "story.paramHint.filterInvert",
};

function filterChannel(fn: StoryFilterFunction): TransformChannelSpec {
    return {
        id: `filter.${fn}`,
        group: "filter",
        label: t => t(FILTER_HINT_KEY[fn] ?? "story.paramHint.filterCss"),
        slot: "cssFilter",
        shares: true,
        stated: ref => filterRecordOf(ref)?.[fn] !== undefined,
        add: ref => withFilterFunction(ref, fn, FILTER_NEUTRAL[fn]),
        remove: ref => withoutFilterFunction(ref, fn),
    };
}

/** A discrete appearance channel, paired with the `null` restore entry that shares its slot. */
function discreteChannels(
    slot: ChannelSlot,
    key: keyof StoryTransformProps,
    labelKey: TranslationKey,
    seed: string,
    clearKeys: readonly (keyof StoryTransformProps)[] = [key],
): TransformChannelSpec[] {
    const clearPatch = Object.fromEntries(clearKeys.map(entry => [entry, null])) as Partial<StoryTransformProps>;
    return [
        {
            id: slot,
            group: "composite",
            label: t => t(labelKey),
            slot,
            stated: ref => {
                const value = propsOf(ref)[key];
                return value !== undefined && value !== null;
            },
            add: ref => withTransformProps(ref, { [key]: seed }),
            remove: ref => withoutTransformProps(ref, clearKeys),
        },
        {
            id: `clear.${slot}`,
            group: "composite",
            label: t => t("storyInspector.transformChannel.restore", { channel: t(labelKey) }),
            slot,
            stated: ref => propsOf(ref)[key] === null,
            add: ref => withTransformProps(ref, clearPatch),
            remove: ref => withoutTransformProps(ref, clearKeys),
        },
    ];
}

const TIMING_HINT_KEY: Record<"delayMs" | "repeat" | "repeatDelayMs", TranslationKey> = {
    delayMs: "story.paramHint.delay",
    repeat: "story.paramHint.repeat",
    repeatDelayMs: "story.paramHint.repeatDelay",
};

function timingChannel(key: "delayMs" | "repeat" | "repeatDelayMs", seed: number): TransformChannelSpec {
    return {
        id: key,
        group: "timing",
        label: t => t(TIMING_HINT_KEY[key]),
        stated: ref => ref[key] !== undefined,
        add: ref => ({ ...ref, mode: "props", [key]: seed }),
        remove: ref => {
            const next = { ...ref };
            delete next[key];
            return next;
        },
    };
}

export const TRANSFORM_CHANNELS: readonly TransformChannelSpec[] = [
    {
        id: "position",
        group: "geometry",
        label: t => t("story.paramHint.placement"),
        stated: ref => propsOf(ref).position !== undefined,
        add: ref => withTransformProps(ref, { position: { xalign: 0.5, yalign: 0.5 } as StoryAlignPositionValue }),
        remove: ref => withoutTransformProps(ref, ["position"]),
    },
    numberChannel("zoom", 1),
    numberChannel("scaleX", 1),
    numberChannel("scaleY", 1),
    numberChannel("rotation", 0),
    numberChannel("opacity", 1),

    ...FILTER_CHANNEL_FUNCTIONS.map(filterChannel),
    {
        id: "filterRaw",
        group: "filter",
        label: t => t("story.paramHint.filterCss"),
        slot: "cssFilter",
        stated: ref => {
            const raw = propsOf(ref).filterRaw;
            return raw !== undefined && raw !== null;
        },
        add: ref => withTransformProps(ref, { filterRaw: "", filter: undefined, look: undefined }),
        remove: ref => withoutTransformProps(ref, ["filterRaw"]),
    },
    {
        id: "clear.cssFilter",
        group: "filter",
        label: t => t("storyInspector.transformChannel.restore", { channel: t("storyInspector.displayableOperation.filter") }),
        slot: "cssFilter",
        stated: ref => propsOf(ref).filter === null || propsOf(ref).filterRaw === null || propsOf(ref).look === null,
        add: ref => withTransformProps(ref, { filter: null, filterRaw: undefined, look: undefined }),
        remove: ref => withoutTransformProps(ref, ["filter", "filterRaw", "look"]),
    },
    {
        // The grade library. It writes the same CSS channel as the eight functions and as a
        // hand-written chain, which is why all three share `cssFilter`.
        id: "look",
        group: "look",
        label: t => t("story.paramHint.cameraLook"),
        slot: "cssFilter",
        stated: ref => Boolean(propsOf(ref).look),
        add: ref => withTransformProps(ref, {
            look: { preset: STORY_CAMERA_LOOK_DEFAULT_PRESET_ID, intensity: 1 },
            filter: undefined,
            filterRaw: undefined,
        }),
        remove: ref => withoutTransformProps(ref, ["look"]),
    },

    ...discreteChannels("mask", "maskAssetId", "story.paramHint.maskImage", "", MASK_KEYS),
    ...discreteChannels("clip", "clipPath", "story.paramHint.clipPath", ""),
    ...discreteChannels("backdrop", "backdropFilter", "story.paramHint.backdropFilter", ""),
    ...discreteChannels("blend", "mixBlendMode", "story.paramHint.blendMode", "normal"),
    {
        // Not a prop. `circleReveal` / `circleClose` / `wipe` synthesize a clip-path every frame
        // rather than setting one, so they sit beside the bag on the ref - see `StoryClipReveal`.
        id: "reveal",
        group: "composite",
        label: t => t("storyInspector.transformChannel.reveal"),
        stated: ref => ref.clipReveal !== undefined,
        add: ref => ({ ...ref, mode: "props", clipReveal: { kind: "circleReveal" } }),
        remove: ref => {
            const next = { ...ref };
            delete next.clipReveal;
            return next;
        },
    },
    {
        id: "fontColor",
        group: "text",
        label: t => t("story.paramHint.color"),
        textOnly: true,
        stated: ref => propsOf(ref).fontColor !== undefined,
        add: ref => withTransformProps(ref, { fontColor: "#ffffff" }),
        remove: ref => withoutTransformProps(ref, ["fontColor"]),
    },

    timingChannel("delayMs", 0),
    timingChannel("repeat", 1),
    timingChannel("repeatDelayMs", 0),
];

const CHANNEL_BY_ID = new Map(TRANSFORM_CHANNELS.map(channel => [channel.id, channel]));

export function transformChannelById(id: TransformChannelId): TransformChannelSpec | undefined {
    return CHANNEL_BY_ID.get(id);
}

/** Every channel the ref states, in the table's order - which is the order an author types them. */
export function statedTransformChannels(ref: StoryTransformRef | undefined): readonly TransformChannelSpec[] {
    return ref ? TRANSFORM_CHANNELS.filter(channel => channel.stated(ref)) : [];
}

/**
 * What the picker may offer: not already stated, and not blocked by whatever holds its slot.
 *
 * A sharing channel is blocked only by a non-sharing occupant (a raw chain shuts the eight functions
 * out); a non-sharing one is blocked by anything in its slot. So a row holding `blur` and
 * `grayscale` still offers `sepia`, and offers neither a raw chain nor a grade.
 */
export function addableTransformChannels(
    ref: StoryTransformRef | undefined,
    options: { isText: boolean },
): readonly TransformChannelSpec[] {
    const current = ref ?? {};
    const occupied = new Map<ChannelSlot, boolean>();
    for (const channel of TRANSFORM_CHANNELS) {
        if (!channel.slot || !channel.stated(current)) {
            continue;
        }
        const sharedSoFar = occupied.get(channel.slot) ?? true;
        occupied.set(channel.slot, sharedSoFar && Boolean(channel.shares));
    }
    return TRANSFORM_CHANNELS.filter(channel => {
        if (channel.textOnly && !options.isText) {
            return false;
        }
        if (channel.stated(current)) {
            return false;
        }
        if (!channel.slot || !occupied.has(channel.slot)) {
            return true;
        }
        return Boolean(channel.shares) && occupied.get(channel.slot) === true;
    });
}

// ---------------------------------------------------------------------------------------------
// The two channels that used to be a CSS text box
// ---------------------------------------------------------------------------------------------

/**
 * A clip path, as the shape an author picked rather than the string it serialises to.
 *
 * `clip-path` accepts a whole grammar, and the row stores that grammar - but three shapes cover
 * what a scene actually asks for, and each of them is a handful of numbers. Parsing back into the
 * shape is what lets the control be a shape: a row written by hand, or by a version of Studio that
 * had only the text box, still opens on whichever branch its string turns out to be.
 *
 * Percentages throughout, so a clip does not change meaning when the stage is resized - the same
 * reason the camera's vignette radii are percentages of the frame.
 */
export type StoryClipShape =
    | { kind: "inset"; top: number; right: number; bottom: number; left: number }
    | { kind: "circle"; radius: number; x: number; y: number }
    | { kind: "ellipse"; radiusX: number; radiusY: number; x: number; y: number }
    /** Anything the three branches above cannot hold, kept verbatim. */
    | { kind: "raw"; value: string };

const NUMBERS = /-?\d+(?:\.\d+)?/g;

function readNumbers(source: string, count: number): number[] | null {
    const found = source.match(NUMBERS)?.map(Number) ?? [];
    return found.length === count && found.every(Number.isFinite) ? found : null;
}

export function parseStoryClipShape(css: string | null | undefined): StoryClipShape {
    const text = (css ?? "").trim();
    if (!text) {
        return { kind: "inset", top: 0, right: 0, bottom: 0, left: 0 };
    }
    const inset = /^inset\(([^)]*)\)$/i.exec(text);
    if (inset) {
        const values = readNumbers(inset[1], 4);
        if (values) {
            return { kind: "inset", top: values[0], right: values[1], bottom: values[2], left: values[3] };
        }
    }
    const circle = /^circle\(([^)]*)\)$/i.exec(text);
    if (circle) {
        const values = readNumbers(circle[1], 3);
        if (values) {
            return { kind: "circle", radius: values[0], x: values[1], y: values[2] };
        }
    }
    const ellipse = /^ellipse\(([^)]*)\)$/i.exec(text);
    if (ellipse) {
        const values = readNumbers(ellipse[1], 4);
        if (values) {
            return { kind: "ellipse", radiusX: values[0], radiusY: values[1], x: values[2], y: values[3] };
        }
    }
    return { kind: "raw", value: text };
}

export function formatStoryClipShape(shape: StoryClipShape): string {
    switch (shape.kind) {
        case "inset":
            return `inset(${shape.top}% ${shape.right}% ${shape.bottom}% ${shape.left}%)`;
        case "circle":
            return `circle(${shape.radius}% at ${shape.x}% ${shape.y}%)`;
        case "ellipse":
            return `ellipse(${shape.radiusX}% ${shape.radiusY}% at ${shape.x}% ${shape.y}%)`;
        default:
            return shape.value;
    }
}

/** The shape a freshly picked kind opens on - visible, centred, and not yet cropping anything away. */
export function seedStoryClipShape(kind: StoryClipShape["kind"], previous: StoryClipShape): StoryClipShape {
    switch (kind) {
        case "inset":
            return { kind: "inset", top: 0, right: 0, bottom: 0, left: 0 };
        case "circle":
            return { kind: "circle", radius: 50, x: 50, y: 50 };
        case "ellipse":
            return { kind: "ellipse", radiusX: 50, radiusY: 35, x: 50, y: 50 };
        default:
            return { kind: "raw", value: previous.kind === "raw" ? previous.value : formatStoryClipShape(previous) };
    }
}

/**
 * A backdrop filter, as a blur radius when that is all it is.
 *
 * `backdrop-filter: blur(8px)` is frosted glass and is very nearly the only thing this channel is
 * ever asked for; every other chain stays text. Same rule as the clip shape: the string decides which
 * control opens, so nothing an author wrote by hand becomes unreachable.
 */
export function parseBackdropBlur(css: string | null | undefined): number | null {
    const match = /^blur\((-?\d+(?:\.\d+)?)px\)$/i.exec((css ?? "").trim());
    return match ? Number(match[1]) : null;
}

export function formatBackdropBlur(radius: number): string {
    return `blur(${radius}px)`;
}
