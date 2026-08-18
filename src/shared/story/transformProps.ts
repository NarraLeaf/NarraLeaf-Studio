import type {
    StoryFilterFunction,
    StoryTransformRef,
    StoryFilterProps,
    StoryTransformProps,
} from "../types/story/document";

/**
 * The prop bag's arithmetic: how a filter is written, how it is read back, and which half of a change
 * may be eased.
 *
 * Lives in `@shared` because the compiler, the editor's stage snapshot, the document migration and the
 * command surface all need the same answers, and the runtime bundle may only import `@shared/**` or
 * `@/lib/ui-editor/**`.
 */

// ---------------------------------------------------------------------------------------------
// Filter: the structured chain
// ---------------------------------------------------------------------------------------------

/**
 * The order the functions are emitted in, always, whatever order they were written in.
 *
 * A CSS filter is a PIPELINE - each function consumes the previous one's output - so the order is
 * part of the value, and a record has none. Fixing one order is what makes the record a value at all:
 * the same record always yields the same string, so a document diff is stable and two rows that mean
 * the same thing cannot render differently.
 *
 * The order chosen is the one the colour-grading recipes in this codebase already follow, and it is
 * the order that composes predictably: flatten the chroma first (`grayscale`, `sepia`), rotate the one
 * hue that is left (`hueRotate`, `invert`), then work on amount rather than identity (`saturate`,
 * `contrast`, `brightness`, `opacity`), and blur last because it is the only spatial operation and
 * running it before a contrast push would re-sharpen its own edges.
 *
 * The cost, stated rather than hidden: a chain whose order does NOT match this one cannot be stored
 * as a record without changing what it looks like. Those go to `filterRaw` - see
 * {@link parseStoryFilter}.
 */
export const STORY_FILTER_FUNCTION_ORDER: readonly StoryFilterFunction[] = [
    "grayscale",
    "sepia",
    "hueRotate",
    "invert",
    "saturate",
    "contrast",
    "brightness",
    "opacity",
    "blur",
];

/** CSS spelling per function - the hyphen belongs to the stylesheet, not to the document. */
const CSS_NAME: Record<StoryFilterFunction, string> = {
    grayscale: "grayscale",
    sepia: "sepia",
    hueRotate: "hue-rotate",
    invert: "invert",
    saturate: "saturate",
    contrast: "contrast",
    brightness: "brightness",
    opacity: "opacity",
    blur: "blur",
};

/** `blur` is a length, `hueRotate` an angle, the rest are bare numbers. A wrong unit is a dropped declaration. */
const CSS_UNIT: Partial<Record<StoryFilterFunction, string>> = {
    blur: "px",
    hueRotate: "deg",
};

/**
 * The value at which each function does nothing - the identity of the CSS pipeline.
 *
 * Used to expand two endpoints onto a common set before comparing them: a filter that gains
 * `brightness` is not going from "no brightness" to 0.6, it is going from `brightness(1)` to
 * `brightness(0.6)`, and that IS interpolable. See {@link splitStoryTransformChange}.
 */
export const STORY_FILTER_IDENTITY: Record<StoryFilterFunction, number> = {
    grayscale: 0,
    sepia: 0,
    hueRotate: 0,
    invert: 0,
    saturate: 1,
    contrast: 1,
    brightness: 1,
    opacity: 1,
    blur: 0,
};

/** Three decimals is finer than any of these terms can be seen at, and keeps `1 - 0.65` out of the string. */
function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/**
 * The CSS a structured chain emits, in canonical order.
 *
 * An empty (or absent) record is `"none"`, which is a valid filter value meaning no filter - the same
 * thing `filter: null` asks for. A non-finite term is dropped rather than printed: `saturate(NaN)` is
 * not parseable, and a browser that cannot parse ONE function drops the WHOLE declaration, so a single
 * bad number would not weaken the grade, it would silently remove it.
 */
export function composeStoryFilter(filter: StoryFilterProps | null | undefined): string {
    if (!filter) {
        return "none";
    }
    const terms: string[] = [];
    for (const fn of STORY_FILTER_FUNCTION_ORDER) {
        const value = filter[fn];
        if (value === undefined || !Number.isFinite(value)) {
            continue;
        }
        terms.push(`${CSS_NAME[fn]}(${round(Math.max(0, value))}${CSS_UNIT[fn] ?? ""})`);
    }
    return terms.length > 0 ? terms.join(" ") : "none";
}

const FILTER_TERM = /([a-z-]+)\(\s*(-?[\d.]+)\s*([a-z%]*)\s*\)/gi;
const CSS_NAME_TO_FUNCTION: Record<string, StoryFilterFunction> = Object.fromEntries(
    STORY_FILTER_FUNCTION_ORDER.map(fn => [CSS_NAME[fn], fn]),
);

/**
 * Read a CSS filter string back into the record that would produce it, or admit that it cannot.
 *
 * The result is one of the two mutually exclusive fields, never both: `{ filter }` when every term is
 * a single-scalar function this module names AND the terms already stand in canonical order, and
 * `{ filterRaw }` otherwise. The order condition is not fussiness - re-emitting `blur(5px)
 * brightness(0.75)` as `brightness(0.75) blur(5px)` is a different picture, and a parse that silently
 * changed what a document looks like would be worse than no parse at all.
 *
 * A single-function string - which is nearly every hand-written filter - always parses.
 */
export function parseStoryFilter(css: string | null | undefined): { filter?: StoryFilterProps; filterRaw?: string } {
    const source = (css ?? "").trim();
    if (!source || source === "none") {
        return { filter: {} };
    }
    const filter: StoryFilterProps = {};
    const seen: StoryFilterFunction[] = [];
    FILTER_TERM.lastIndex = 0;
    for (let match = FILTER_TERM.exec(source); match; match = FILTER_TERM.exec(source)) {
        const fn = CSS_NAME_TO_FUNCTION[match[1].toLowerCase()];
        const value = Number(match[2]);
        const unit = match[3].toLowerCase();
        if (!fn || !Number.isFinite(value)) {
            return { filterRaw: source };
        }
        // A percentage is the same value on a 0..1 scale; anything else (`rem`, `turn`) is a term this
        // record cannot hold without converting, and a wrong conversion is worse than the escape hatch.
        const expected = CSS_UNIT[fn] ?? "";
        const normalized = unit === "%" && !expected ? value / 100 : value;
        if (unit && unit !== "%" && unit !== expected) {
            return { filterRaw: source };
        }
        if (fn in filter) {
            return { filterRaw: source };
        }
        filter[fn] = normalized;
        seen.push(fn);
    }
    if (seen.length === 0) {
        return { filterRaw: source };
    }
    // Everything outside the matched terms must be whitespace - otherwise the string carries something
    // this parse did not see (a `drop-shadow(...)`, a `url(#f)`), and half a filter is not a filter.
    if (stripTerms(source).trim().length > 0) {
        return { filterRaw: source };
    }
    const canonical = STORY_FILTER_FUNCTION_ORDER.filter(fn => seen.includes(fn));
    if (canonical.join(",") !== seen.join(",")) {
        return { filterRaw: source };
    }
    return { filter };
}

function stripTerms(source: string): string {
    return source.replace(FILTER_TERM, " ");
}

// ---------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------

/** A prop bag that says two things about one channel. */
export type StoryTransformPropsConflict = "filterBoth";

/**
 * `filter` and `filterRaw` both write the CSS `filter` channel, so a bag carrying both has no single
 * answer and the emitter would silently take whichever it reads last. Reported rather than resolved,
 * following `/font`, which refuses a size and a colour in one row for the same reason.
 */
export function storyTransformPropsConflicts(props: StoryTransformProps | undefined): StoryTransformPropsConflict[] {
    if (!props) {
        return [];
    }
    return props.filter !== undefined && props.filterRaw !== undefined ? ["filterBoth"] : [];
}

// ---------------------------------------------------------------------------------------------
// Cut vs tween
// ---------------------------------------------------------------------------------------------

/** The props that must land in one frame, and the props that may be eased. */
export type StoryTransformChange = {
    cut: StoryTransformProps;
    tween: StoryTransformProps;
};

/** Every discrete channel: a string or an id, with no midpoint that means anything. */
const DISCRETE_KEYS = [
    "maskAssetId",
    "maskSize",
    "maskPosition",
    "maskRepeat",
    "maskMode",
    "clipPath",
    "mixBlendMode",
    "filterRaw",
    // A colour is a string here, and the keyframe layer already holds one until the next keyframe
    // rather than mixing two - so a colour behaves the same way on this path.
    "fontColor",
] as const;

const NUMERIC_KEYS = ["zoom", "scaleX", "scaleY", "rotation", "opacity"] as const;

/**
 * Split a change into the half that cuts and the half that tweens.
 *
 * **Numeric geometry always tweens.** `position`, `zoom`, `scaleX`, `scaleY`, `rotation` and `opacity`
 * are continuous and every point between two of them is a pose the author would recognise.
 *
 * **The string channels always cut.** `maskAssetId`, the four mask settings, `clipPath`,
 * `mixBlendMode`, `filterRaw` and `fontColor` have no midpoint: there is no halfway between two mask
 * images. This is what the keyframe layer already does - `interpolateValue` holds a string keyframe
 * until the next one is reached rather than mixing them - so both paths now agree.
 *
 * **`filter` depends on the angle.** Both endpoints are expanded onto the UNION of their function
 * sets, each missing function filled with its CSS identity, and then:
 *   - if `hueRotate` differs between the two expansions - INCLUDING identity to non-zero - the whole
 *     filter cuts;
 *   - otherwise it tweens.
 *
 * That rule is the one `1e626400` measured. Easing `moonlight` on from neutral moves the angle 0 → 185
 * while `grayscale` lets the source's own hues back in, and the picture goes blue → cyan → green →
 * olive with a green face at the midpoint. Nothing about that is fixable by interpolating better; the
 * honest operation is a cross-fade between two graded renderings and a CSS filter cannot express one.
 * But the rule is deliberately finer than "a filter always cuts": dimming the character who is not
 * speaking is `brightness` 1 → 0.6, no angle moves, and fading it is exactly what the author asked
 * for. Two strengths of one grade hold their angle constant and tween for the same reason.
 *
 * **`backdropFilter` cuts.** It is stored as a raw string (there is no structured form and no second
 * customer for one), so it is discrete by the same argument `filterRaw` is - and it is the more
 * cautious answer for a channel that samples what is BEHIND the element: easing a backdrop blur eases
 * the whole plate showing through it, which is the same class of surprise the hue sweep was.
 *
 * `from` may be omitted, and then the neutral bag stands in for it - which is the true statement about
 * a row that names only a destination: it is asking to arrive somewhere, and the only start value the
 * document knows is the identity.
 */
export function splitStoryTransformChange(
    from: StoryTransformProps | undefined,
    to: StoryTransformProps | undefined,
): StoryTransformChange {
    const cut: StoryTransformProps = {};
    const tween: StoryTransformProps = {};
    if (!to) {
        return { cut, tween };
    }
    if (to.position !== undefined) {
        tween.position = to.position;
    }
    for (const key of NUMERIC_KEYS) {
        if (to[key] !== undefined) {
            tween[key] = to[key];
        }
    }
    for (const key of DISCRETE_KEYS) {
        if (to[key] !== undefined) {
            (cut as Record<string, unknown>)[key] = to[key];
        }
    }
    if (to.backdropFilter !== undefined) {
        cut.backdropFilter = to.backdropFilter;
    }
    if (to.filter !== undefined) {
        if (isFilterTweenable(from?.filter, to.filter)) {
            tween.filter = to.filter;
        } else {
            cut.filter = to.filter;
        }
    }
    return { cut, tween };
}

/** True when no `hue-rotate` angle moves between the two endpoints, expanded onto their union. */
export function isFilterTweenable(
    from: StoryFilterProps | null | undefined,
    to: StoryFilterProps | null | undefined,
): boolean {
    const fromAngle = from?.hueRotate ?? STORY_FILTER_IDENTITY.hueRotate;
    const toAngle = to?.hueRotate ?? STORY_FILTER_IDENTITY.hueRotate;
    return fromAngle === toAngle;
}

// ---------------------------------------------------------------------------------------------
// Bag utilities
// ---------------------------------------------------------------------------------------------

/**
 * True when the bag says nothing but "which way this faces".
 *
 * A mirror IS a negative `scaleX` - `Displayable.scale` documents "use negative value to invert the
 * scale" and NLR maps the pair onto `scale(zoom*scaleX, zoom*scaleY)` - so `/mirror` and `/transform`
 * write the same payload and only the shape of the bag tells them apart. The distinguishing fact is
 * that a mirror touches the horizontal axis ALONE: writing a `scaleY` beside it would reset a vertical
 * scale an earlier row had set, which is why the mirror never writes one.
 */
export function isMirrorTransform(ref: StoryTransformRef | undefined): boolean {
    const to = ref?.to;
    if (!to || ref?.clipReveal) {
        return false;
    }
    const keys = Object.entries(to).filter(([, value]) => value !== undefined).map(([key]) => key);
    return keys.length === 1 && keys[0] === "scaleX";
}

export function isEmptyStoryTransformProps(props: StoryTransformProps | undefined): boolean {
    return !props || Object.values(props).every(value => value === undefined);
}

/** Drop `undefined` entries so a stored bag is the set of channels the row actually states. */
export function pruneStoryTransformProps(props: StoryTransformProps | undefined): StoryTransformProps | undefined {
    if (!props) {
        return undefined;
    }
    const next = Object.fromEntries(
        Object.entries(props).filter(([, value]) => value !== undefined),
    ) as StoryTransformProps;
    return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The bag as NarraLeaf-React's `Partial<ImageTransformProps>`.
 *
 * `maskAssetId` is NOT translated here: the engine resolves a mask through `Displayable.mask`, which
 * also registers the source for preload, and only the compiler can await that. The caller passes the
 * resolved `url(...)` (or `"none"`) as `maskImage` if it has one.
 *
 * `null` becomes the CSS neutral, which is `"none"` for every channel that takes one and `"normal"`
 * for a blend mode.
 */
export function storyTransformPropsToNlr(
    props: StoryTransformProps | undefined,
    maskImage?: string,
): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    if (!props) {
        return next;
    }
    assign(next, "position", props.position);
    assign(next, "zoom", props.zoom);
    assign(next, "scaleX", props.scaleX);
    assign(next, "scaleY", props.scaleY);
    assign(next, "rotation", props.rotation);
    assign(next, "opacity", props.opacity);
    assign(next, "fontColor", props.fontColor);
    assign(next, "maskSize", cssOrNone(props.maskSize));
    assign(next, "maskPosition", cssOrNone(props.maskPosition));
    assign(next, "maskRepeat", cssOrNone(props.maskRepeat));
    assign(next, "maskMode", cssOrNone(props.maskMode));
    assign(next, "clipPath", cssOrNone(props.clipPath));
    assign(next, "backdropFilter", cssOrNone(props.backdropFilter));
    assign(next, "mixBlendMode", props.mixBlendMode === null ? "normal" : props.mixBlendMode);
    if (props.filterRaw !== undefined) {
        next.filter = props.filterRaw === null ? "none" : props.filterRaw;
    } else if (props.filter !== undefined) {
        next.filter = composeStoryFilter(props.filter);
    }
    if (maskImage !== undefined) {
        next.maskImage = maskImage;
    }
    return next;
}

function cssOrNone(value: string | null | undefined): string | undefined {
    return value === undefined ? undefined : value === null ? "none" : value;
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) {
        target[key] = value;
    }
}

/**
 * The bag that puts a displayable back the way it was drawn - what `/reset <target>` with no props
 * writes.
 *
 * Stated as a value rather than as an empty bag, because "leave it" and "put it back" are the two
 * different instructions this type exists to keep apart: an empty bag says nothing and would compile
 * to nothing at all. Every continuous channel gets its neutral number and every discrete one gets
 * `null`, which is exactly what the engine's `clearMask` / `clearClip` / `clearFilter` did before v18
 * folded them into the bag.
 *
 * `fontColor` is deliberately absent. It is the one channel with no neutral: a text's colour is
 * whatever its create row gave it, the engine has no "unset colour", and writing white here would be
 * a reset that recolours every text an author had made amber. A colour is changed by naming the next
 * one.
 *
 * `position` is centre, which IS the stage neutral - `getPresetPosition("center")` is what a create
 * row seeds, so a reset lands where an untouched sprite would have stood.
 */
export function neutralStoryTransformProps(): StoryTransformProps {
    return {
        position: { xalign: 0.5, yalign: 0.5 },
        zoom: 1,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        maskAssetId: null,
        maskSize: null,
        maskPosition: null,
        maskRepeat: null,
        maskMode: null,
        clipPath: null,
        backdropFilter: null,
        mixBlendMode: null,
        // The structured channel alone: `filter` and `filterRaw` are two writers of ONE CSS channel
        // and a bag carrying both is a `filterBoth` conflict, so a reset states the one that owns it.
        // `composeStoryFilter(null)` is `"none"`, which is what clearing the channel means.
        filter: null,
    };
}

/**
 * Whether this bag is exactly the neutral one - i.e. whether the row that carries it is a `/reset`.
 *
 * Deep equality against {@link neutralStoryTransformProps} rather than "every value is at its
 * neutral", and the difference matters: a row that only says `opacity: 1` is a fade-in, not a reset,
 * and printing it as one would tell the author it undoes things it never touches. A reset writes the
 * whole bag at once, so the whole bag is what identifies it.
 */
export function isNeutralStoryTransformProps(props: StoryTransformProps | undefined): boolean {
    if (!props) {
        return false;
    }
    const neutral = neutralStoryTransformProps() as Record<string, unknown>;
    const stated = Object.entries(props).filter(([, value]) => value !== undefined);
    if (stated.length !== Object.keys(neutral).length) {
        return false;
    }
    return stated.every(([key, value]) => JSON.stringify(value) === JSON.stringify(neutral[key]));
}
