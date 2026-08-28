import type { StoryClipReveal, StoryTransformProps } from "../types/story/document";

/**
 * What the placement and gesture words mean, as the prop bag they each stand for.
 *
 * These twenty words were once a closed `StoryTransformPreset` enum and the only way to state a
 * transform. The bag replaced them, but the words did not go away: the inspector still offers them,
 * the command line still accepts them, and every surface that has to answer the inverse question -
 * given an xalign, which word lands there - reads the same table. So this is a live vocabulary with
 * a legacy spelling, not a converter.
 *
 * Every value has a determinate expansion and none of them needed a judgement call, because the
 * expansions were already written down twice: `getInlineTransformProps` (the props a preset folds into
 * a show) and `applyTransformPreset` (the chained call it compiles to). This module is those two
 * agreeing in one place. Where they disagreed - the two placement families dropped an explicit `zoom`
 * the folding path kept - the union is taken, which is the reading that loses nothing.
 *
 * Kept in `@shared` rather than beside the story editor because the runtime's own transform props
 * read it too, and the runtime bundle may not import from `@/lib/workspace/**`.
 */

/** The 20 values `StoryTransformPreset` held, as they survive only in documents on disk. */
export type LegacyStoryTransformPreset =
    | "none" | "left" | "center" | "right" | "custom"
    | "fadeIn" | "fadeOut"
    | "slideLeft" | "slideRight" | "slideUp" | "slideDown"
    | "zoom" | "scale" | "rotate" | "flip" | "opacity" | "darken"
    | "circleReveal" | "circleClose" | "wipe";

type LegacyParams = Record<string, unknown>;

function num(params: LegacyParams, key: string): number | undefined {
    const value = params[key];
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function str(params: LegacyParams, key: string): string | undefined {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * The position a placement word settles on, offsets carried through.
 *
 * Still the one forward definition of where `left` / `center` / `right` are, which several surfaces
 * read to answer the inverse question (given an xalign, which word lands there). The slide words are
 * here for the same reason the migration is: they were placements wearing a different name.
 */
export function legacyPresetPosition(preset: string, params: LegacyParams = {}): StoryTransformProps["position"] {
    const xalign = num(params, "xalign") ?? num(params, "x");
    const yalign = num(params, "yalign") ?? num(params, "y") ?? 0.5;
    const xoffset = num(params, "xoffset") ?? num(params, "xOffset");
    const yoffset = num(params, "yoffset") ?? num(params, "yOffset");
    const withOffsets = (x: number, y: number): StoryTransformProps["position"] => ({
        xalign: x,
        yalign: y,
        ...(xoffset !== undefined ? { xoffset } : {}),
        ...(yoffset !== undefined ? { yoffset } : {}),
    });
    switch (preset) {
        case "left": return withOffsets(0.25, yalign);
        case "center": return withOffsets(0.5, yalign);
        case "right": return withOffsets(0.75, yalign);
        case "custom": return withOffsets(xalign ?? 0.5, yalign);
        case "slideLeft": return withOffsets(xalign ?? 0.25, yalign);
        case "slideRight": return withOffsets(xalign ?? 0.75, yalign);
        case "slideUp": return withOffsets(xalign ?? 0.5, yalign ?? 0.7);
        case "slideDown": return withOffsets(xalign ?? 0.5, yalign ?? 0.3);
        default: return undefined;
    }
}

export type LegacyPresetExpansion = {
    to: StoryTransformProps;
    clipReveal?: StoryClipReveal;
};

/**
 * One preset plus its loose `props` bag, as the bag it always meant.
 *
 * `fadeIn` / `fadeOut` become an opacity because that is what the engine's `show()` / `hide()` animate;
 * `darken` becomes a `brightness`, because `Displayable.darken(d)` IS `filter("brightness(1 - d)")`;
 * `flip` becomes a negative `scaleX` and deliberately leaves `scaleY` alone, since a mirror is
 * horizontal by definition and restating a vertical scale would reset one an earlier row had set.
 *
 * The three clip-path presets do not become props at all - see {@link StoryClipReveal}.
 */
export function expandLegacyTransformPreset(
    preset: LegacyStoryTransformPreset | string | undefined,
    params: LegacyParams = {},
): LegacyPresetExpansion {
    const to: StoryTransformProps = {};
    if (!preset || preset === "none") {
        return { to };
    }
    // Every preset carried an explicit `zoom` through the folding path, whatever else it set.
    const explicitZoom = num(params, "zoom");
    if (explicitZoom !== undefined) {
        to.zoom = explicitZoom;
    }
    const position = legacyPresetPosition(preset as LegacyStoryTransformPreset, params);
    if (position) {
        to.position = position;
        return { to };
    }
    switch (preset) {
        case "fadeIn":
            to.opacity = 1;
            return { to };
        case "fadeOut":
            to.opacity = 0;
            return { to };
        case "zoom":
            to.zoom = explicitZoom ?? 1;
            return { to };
        case "scale": {
            const scale = num(params, "scale") ?? 1;
            to.scaleX = num(params, "scaleX") ?? scale;
            to.scaleY = num(params, "scaleY") ?? scale;
            return { to };
        }
        case "flip":
            to.scaleX = num(params, "scaleX") ?? -1;
            return { to };
        case "rotate":
            to.rotation = num(params, "rotation") ?? num(params, "degrees") ?? 0;
            return { to };
        case "opacity":
            to.opacity = num(params, "opacity") ?? 1;
            return { to };
        case "darken":
            to.filter = { brightness: 1 - (num(params, "darkness") ?? 0.5) };
            return { to };
        case "circleReveal":
        case "circleClose":
            return { to, clipReveal: pruneClipReveal({
                kind: preset,
                center: str(params, "center"),
                fromRadius: num(params, "from"),
                toRadius: num(params, "to"),
            }) };
        case "wipe":
            return { to, clipReveal: pruneClipReveal({
                kind: "wipe",
                direction: wipeDirection(str(params, "direction")),
                reverse: params.reverse === true ? true : undefined,
            }) };
        default:
            return { to };
    }
}

function wipeDirection(value: string | undefined): StoryClipReveal["direction"] {
    return value === "left" || value === "right" || value === "top" || value === "bottom" ? value : undefined;
}

function pruneClipReveal(reveal: StoryClipReveal): StoryClipReveal {
    return Object.fromEntries(Object.entries(reveal).filter(([, value]) => value !== undefined)) as StoryClipReveal;
}
