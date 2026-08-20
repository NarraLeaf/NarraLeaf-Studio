import type { StoryClipReveal, StoryTransformProps, StoryTransformRef } from "../types/story/document";
import { parseStoryFilter, pruneStoryTransformProps } from "./transformProps";

/**
 * The v17→v18 expansion of the two closed enums into the one prop bag.
 *
 * Every value has a determinate expansion and none of them needed a judgement call, because the
 * expansions were already written down twice: `getInlineTransformProps` (the props a preset folds into
 * a show) and `applyTransformPreset` (the chained call it compiles to). This module is those two
 * agreeing in one place. Where they disagreed - the two placement families dropped an explicit `zoom`
 * the folding path kept - the union is taken, which is the reading that loses nothing.
 *
 * Kept in `@shared` rather than beside the migration because the story compiler's own tests build
 * legacy documents, and the runtime bundle may not import from `@/lib/workspace/**`.
 */

/** The 20 values `StoryTransformPreset` held, as they survive only in documents on disk. */
export type LegacyStoryTransformPreset =
    | "none" | "left" | "center" | "right" | "custom"
    | "fadeIn" | "fadeOut"
    | "slideLeft" | "slideRight" | "slideUp" | "slideDown"
    | "zoom" | "scale" | "rotate" | "flip" | "opacity" | "darken"
    | "circleReveal" | "circleClose" | "wipe";

/** The 12 `displayable` operations that were single props of the bag. */
export type LegacyDisplayableEffectOperation =
    | "mask" | "clearMask" | "clip" | "clearClip" | "filter" | "clearFilter"
    | "backdrop" | "blend" | "darken" | "circleReveal" | "circleClose" | "wipe";

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

/** A whole legacy transform ref (preset + loose props + timing) as a v18 one. */
export function migrateLegacyTransformRef(ref: unknown): StoryTransformRef | undefined {
    if (!ref || typeof ref !== "object") {
        return undefined;
    }
    const legacy = ref as Record<string, unknown>;
    if (legacy.mode === "animation") {
        return prunedRef({
            mode: "animation",
            animationId: typeof legacy.animationId === "string" ? legacy.animationId : undefined,
            durationMs: typeof legacy.durationMs === "number" ? legacy.durationMs : undefined,
            easing: typeof legacy.easing === "string" ? legacy.easing : undefined,
        });
    }
    // Already migrated (or authored fresh): a v18 ref carries `to` / `from` / `clipReveal` and no preset.
    if (legacy.to !== undefined || legacy.from !== undefined || legacy.clipReveal !== undefined) {
        return ref as StoryTransformRef;
    }
    const params = (legacy.props && typeof legacy.props === "object" ? legacy.props : {}) as LegacyParams;
    const { to, clipReveal } = expandLegacyTransformPreset(legacy.preset as string | undefined, params);
    return prunedRef({
        mode: "props",
        to: pruneStoryTransformProps(to),
        clipReveal,
        durationMs: typeof legacy.durationMs === "number" ? legacy.durationMs : undefined,
        easing: typeof legacy.easing === "string" ? legacy.easing : undefined,
    });
}

function prunedRef(ref: StoryTransformRef): StoryTransformRef {
    return Object.fromEntries(Object.entries(ref).filter(([, value]) => value !== undefined)) as StoryTransformRef;
}

/**
 * A legacy `displayable` payload's effect operation as the prop it set.
 *
 * `maskAssetId` is the asset id verbatim - the bag stores an id, not a URL, so nothing is resolved
 * here. `filter` is parsed into the structured record when the string permits it and falls back to
 * `filterRaw` when it does not, which is the honest answer for a chain whose order matters. Each
 * `clear*` becomes the channel's neutral, spelled `null`.
 */
export function expandLegacyDisplayableEffect(
    operation: LegacyDisplayableEffectOperation | string,
    payload: Record<string, unknown>,
): LegacyPresetExpansion {
    const to: StoryTransformProps = {};
    switch (operation) {
        case "mask":
            to.maskAssetId = typeof payload.maskAssetId === "string" ? payload.maskAssetId : null;
            return { to };
        case "clearMask":
            to.maskAssetId = null;
            return { to };
        case "clip":
            to.clipPath = typeof payload.clipPath === "string" ? payload.clipPath : null;
            return { to };
        case "clearClip":
            to.clipPath = null;
            return { to };
        case "filter": {
            const parsed = parseStoryFilter(typeof payload.filter === "string" ? payload.filter : null);
            if (parsed.filterRaw !== undefined) {
                to.filterRaw = parsed.filterRaw;
            } else {
                to.filter = parsed.filter ?? {};
            }
            return { to };
        }
        case "clearFilter":
            to.filter = null;
            return { to };
        case "backdrop":
            to.backdropFilter = typeof payload.backdropFilter === "string" ? payload.backdropFilter : null;
            return { to };
        case "blend":
            to.mixBlendMode = typeof payload.mixBlendMode === "string" ? payload.mixBlendMode : "normal";
            return { to };
        case "darken": {
            const darkness = typeof payload.darkness === "number" ? payload.darkness : 0;
            to.filter = { brightness: 1 - Math.min(1, Math.max(0, darkness)) };
            return { to };
        }
        case "circleReveal":
        case "circleClose":
        case "wipe": {
            const params = (payload.effectProps && typeof payload.effectProps === "object"
                ? payload.effectProps
                : {}) as LegacyParams;
            return expandLegacyTransformPreset(operation, params);
        }
        default:
            return { to };
    }
}
