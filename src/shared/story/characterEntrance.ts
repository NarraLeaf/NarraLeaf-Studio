import type {
    StoryAlignPositionValue,
    StoryCameraLookRef,
    StoryFilterProps,
    StoryTransformProps,
    StoryTransformRef,
} from "../types/story/document";
import { STORY_FILTER_FUNCTION_ORDER } from "./transformProps";

/**
 * A character's entrance defaults: the transform props an `enter` row falls back to, channel by
 * channel.
 *
 * **Why a character holds them.** Everything else about how a character is drawn already lives on
 * the character - which pose, which tags, which avatar, which colour, which voice bus. How big she
 * is drawn, which way she faces and where her feet land did not, so every `/show` row had to restate
 * it: one shipped project carries the same `zoom` and the same `yalign` on 55 rows, and those numbers
 * are derived from the artwork's pixel size, which is nowhere an author can see. A number that has to
 * be identical on every row is not a decision a row makes.
 *
 * **The fallback is per channel, not per bag.** `/show Alice pos=left` states one alignment and
 * nothing else; if a stated bag replaced the defaults whole, the most ordinary entrance line there is
 * would drop the character's scale and baseline and stand her somewhere she was never meant to. So a
 * row overrides the channels it names and inherits the rest, and `position` merges by its four
 * numbers rather than as one object.
 *
 * **Only an entrance falls back.** `move` and `exit` address a character an earlier row already put
 * on stage, and the engine's transform is incremental - a row naming only `pos=` leaves every other
 * prop as it stands. An entrance is the one point with no previous state to inherit from, which is
 * why it is the one that needs a default.
 */

/**
 * The props an entrance default may carry.
 *
 * A whitelist rather than the whole bag, because three groups of channels mean nothing on a
 * character's entrance and would each fail silently in a different way:
 *
 *  - `fontColor` belongs to a text object;
 *  - the six lens channels and `lens` are the camera's own glass, which no sprite has;
 *  - a mask is refused by the entrance itself - resolving one needs an await that the entrance's
 *    single statement has no room for, and `createShowTransform` already reports a row asking for
 *    one. Kept out of the record rather than dropped at compile time, so no author is ever shown a
 *    warning naming a row that does not carry what the warning is about.
 *
 * Everything else the inspector can state is here: the geometry, the three filter writers and the
 * three composite channels.
 */
export const CHARACTER_ENTRANCE_PROP_KEYS = [
    "position",
    "zoom",
    "scaleX",
    "scaleY",
    "rotation",
    "opacity",
    "clipPath",
    "backdropFilter",
    "mixBlendMode",
    "filter",
    "filterRaw",
    "look",
] as const satisfies readonly (keyof StoryTransformProps)[];

export type CharacterEntrancePropKey = (typeof CHARACTER_ENTRANCE_PROP_KEYS)[number];

/** The three writers of the single CSS filter channel - see `storyTransformPropsConflicts`. */
const FILTER_WRITER_KEYS = ["filter", "filterRaw", "look"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cssValue(value: unknown): string | null | undefined {
    if (value === null) {
        return null;
    }
    return typeof value === "string" ? value : undefined;
}

function sanitizePosition(value: unknown): StoryAlignPositionValue | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const next: StoryAlignPositionValue = {};
    for (const key of ["xalign", "yalign", "xoffset", "yoffset"] as const) {
        const number = finiteNumber(value[key]);
        if (number !== undefined) {
            next[key] = number;
        }
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeFilter(value: unknown): StoryFilterProps | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const next: StoryFilterProps = {};
    for (const fn of STORY_FILTER_FUNCTION_ORDER) {
        const number = finiteNumber(value[fn]);
        if (number !== undefined) {
            next[fn] = number;
        }
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeLook(value: unknown): StoryCameraLookRef | null | undefined {
    if (value === null) {
        return null;
    }
    if (!isRecord(value) || typeof value.preset !== "string" || !value.preset.trim()) {
        return undefined;
    }
    const intensity = finiteNumber(value.intensity);
    return { preset: value.preset, ...(intensity === undefined ? {} : { intensity }) };
}

/**
 * Read a stored entrance default, keeping only what a character's entrance can act on.
 *
 * Defensive in the way `mapCharacterStoreEntriesToSummaries` is defensive: this record comes from
 * `character.json`, which an author may have edited by hand and a plugin may have written, so every
 * value is checked rather than trusted. A key that fails its check is dropped, not defaulted - the
 * character then has no default on that channel, which is the state every character was in before
 * this field existed.
 */
export function sanitizeCharacterEntranceProps(value: unknown): StoryTransformProps | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const next: StoryTransformProps = {};
    const position = sanitizePosition(value.position);
    if (position) {
        next.position = position;
    }
    for (const key of ["zoom", "scaleX", "scaleY", "rotation", "opacity"] as const) {
        const number = finiteNumber(value[key]);
        if (number !== undefined) {
            next[key] = number;
        }
    }
    for (const key of ["clipPath", "backdropFilter", "mixBlendMode"] as const) {
        const css = cssValue(value[key]);
        if (css !== undefined) {
            next[key] = css;
        }
    }
    // The three filter writers are alternatives for one CSS property, and a record carrying two of
    // them says nothing about which an author chose. Read in the order the inspector offers them and
    // keep the first, so a hand-edited file resolves to one writer rather than to whichever the
    // emitter happens to read last.
    const filter = sanitizeFilter(value.filter);
    const filterRaw = cssValue(value.filterRaw);
    const look = sanitizeLook(value.look);
    if (filter) {
        next.filter = filter;
    } else if (filterRaw !== undefined) {
        next.filterRaw = filterRaw;
    } else if (look !== undefined) {
        next.look = look;
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

/** Whether a bag states one of the three writers of the CSS filter channel. */
function statesFilter(props: StoryTransformProps | undefined): boolean {
    return Boolean(props) && FILTER_WRITER_KEYS.some(key => props?.[key] !== undefined);
}

/**
 * The props an entrance settles on: the character's defaults with the row's own bag laid over them,
 * channel by channel.
 *
 * The filter channel is the one that does not merge key by key. Its three writers are alternatives
 * for one CSS property, so a row stating any of them takes the channel whole - merging a stated
 * `filterRaw` with an inherited `filter` record would emit two chains and let whichever the emitter
 * read last win, which is the ambiguity those writers are kept exclusive to prevent.
 */
export function mergeCharacterEntranceProps(
    defaults: StoryTransformProps | undefined,
    stated: StoryTransformProps | undefined,
): StoryTransformProps | undefined {
    if (!defaults) {
        return stated;
    }
    const merged: StoryTransformProps = { ...defaults };
    if (statesFilter(stated)) {
        for (const key of FILTER_WRITER_KEYS) {
            delete merged[key];
        }
    }
    for (const [key, value] of Object.entries(stated ?? {})) {
        if (value !== undefined) {
            (merged as Record<string, unknown>)[key] = value;
        }
    }
    if (defaults.position && stated?.position) {
        merged.position = { ...defaults.position, ...sanitizePosition(stated.position) };
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * The entrance transform a row compiles to, defaults folded in.
 *
 * A `mode: "animation"` ref is returned untouched. A Story Motion states its own keyframes and its
 * own timing, and there is no bag on it to merge into; what carries the character's scale under one
 * is the element's constructor pose - see the entrance sites in `storyCompiler`.
 */
export function withCharacterEntranceDefaults(
    defaults: StoryTransformProps | undefined,
    ref: StoryTransformRef | undefined,
): StoryTransformRef | undefined {
    if (!defaults || ref?.mode === "animation") {
        return ref;
    }
    const to = mergeCharacterEntranceProps(defaults, ref?.to);
    if (!to) {
        return ref;
    }
    return { ...(ref ?? {}), mode: "props", to };
}

/**
 * The defaults a row does NOT state, which is what the inspector shows as inherited.
 *
 * Derived from the same rules the merge above runs rather than from a second walk of the keys, so
 * what the panel lists as coming from the character is what the entrance will actually use.
 */
export function inheritedCharacterEntranceProps(
    defaults: StoryTransformProps | undefined,
    ref: StoryTransformRef | undefined,
): StoryTransformProps | undefined {
    if (!defaults || ref?.mode === "animation") {
        return undefined;
    }
    const stated = ref?.to;
    const inherited: StoryTransformProps = {};
    for (const [key, value] of Object.entries(defaults)) {
        if (value === undefined) {
            continue;
        }
        if (key === "position") {
            const overridden = sanitizePosition(stated?.position) ?? {};
            const rest = Object.fromEntries(
                Object.entries(value as StoryAlignPositionValue)
                    .filter(([axis]) => (overridden as Record<string, unknown>)[axis] === undefined),
            );
            if (Object.keys(rest).length > 0) {
                inherited.position = rest;
            }
            continue;
        }
        if (FILTER_WRITER_KEYS.includes(key as (typeof FILTER_WRITER_KEYS)[number]) && statesFilter(stated)) {
            continue;
        }
        if (stated?.[key as keyof StoryTransformProps] === undefined) {
            (inherited as Record<string, unknown>)[key] = value;
        }
    }
    return Object.keys(inherited).length > 0 ? inherited : undefined;
}
