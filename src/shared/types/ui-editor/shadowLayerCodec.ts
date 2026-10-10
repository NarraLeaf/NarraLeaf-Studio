/**
 * Parse/serialize single box-shadow / text-shadow fragments for stored effect layers.
 * Shared between editor UI and runtime CSS composition (no React).
 */

import { getActiveBrandPalette } from "@shared/brand/brandRegistry";

export type ShadowLikeLayer = {
    inset: boolean;
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    color: string;
};

function extractTrailingColorToken(s: string): { before: string; color: string } | null {
    const t = s.trimEnd();
    const rgbaRgb = t.match(/\s+((?:rgb|rgba)\([^)]+\))\s*$/i);
    if (rgbaRgb && rgbaRgb.index !== undefined) {
        return { before: t.slice(0, rgbaRgb.index).trimEnd(), color: rgbaRgb[1].trim() };
    }
    const hex = t.match(/\s+(#[0-9a-fA-F]{3,8})\s*$/i);
    if (hex && hex.index !== undefined) {
        return { before: t.slice(0, hex.index).trimEnd(), color: hex[1].trim() };
    }
    const named = t.match(/\s+([a-z]{3,})\s*$/i);
    if (named && named.index !== undefined) {
        return { before: t.slice(0, named.index).trimEnd(), color: named[1].trim() };
    }
    return null;
}

function parsePxToken(token: string): number | null {
    const t = token.trim();
    const m = t.match(/^(-?[\d.]+)(px)?$/i);
    if (!m) {
        return null;
    }
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

export function parseShadowLikeFragment(raw: string): { ok: true; value: ShadowLikeLayer } | { ok: false } {
    let s = raw.trim();
    if (!s) {
        return { ok: false };
    }
    let inset = false;
    if (/^inset\s+/i.test(s)) {
        inset = true;
        s = s.replace(/^inset\s+/i, "").trim();
    }
    const extracted = extractTrailingColorToken(s);
    if (!extracted) {
        return { ok: false };
    }
    const { before, color } = extracted;
    const parts = before.split(/\s+/).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) {
        return { ok: false };
    }
    const nums: number[] = [];
    for (const p of parts) {
        const n = parsePxToken(p);
        if (n === null) {
            return { ok: false };
        }
        nums.push(n);
    }
    let offsetX: number;
    let offsetY: number;
    let blur: number;
    let spread: number;
    if (nums.length === 2) {
        [offsetX, offsetY] = nums;
        blur = 0;
        spread = 0;
    } else if (nums.length === 3) {
        [offsetX, offsetY, blur] = nums;
        spread = 0;
    } else {
        [offsetX, offsetY, blur, spread] = nums;
    }
    return { ok: true, value: { inset, offsetX, offsetY, blur, spread, color } };
}

export type ShadowSerializeMode = "outer" | "inner" | "glow";

export function serializeShadowLikeLayer(value: ShadowLikeLayer, mode: ShadowSerializeMode): string {
    const inset = mode === "inner" ? true : mode === "outer" ? false : value.inset;
    const { offsetX, offsetY, blur, spread, color } = value;
    const parts: string[] = [`${offsetX}px`, `${offsetY}px`, `${blur}px`];
    if (spread !== 0) {
        parts.push(`${spread}px`);
    }
    parts.push(color);
    const core = parts.join(" ");
    return inset ? `inset ${core}` : core;
}

/** Stored layer without inset flag (inset comes from effect kind: inner vs outer). */
export type EffectShadowLayerData = {
    offsetX: number;
    offsetY: number;
    blur: number;
    spread: number;
    color: string;
};

export function layerDataToShadowLike(layer: EffectShadowLayerData, inset: boolean): ShadowLikeLayer {
    return { inset, ...layer };
}

/**
 * The stored layer as one CSS fragment, with a brand link resolved to the colour it stands for.
 *
 * The resolve happens here rather than at each paint site because a `box-shadow` is one string: an
 * unresolved `nlbrand:` token in the middle of it makes the browser drop the *whole* declaration, so
 * a shadow whose colour follows the palette would simply not exist. Reaching the registry directly
 * (rather than through the `colorUtils` pair) keeps this module where it is - shared, no React, no
 * renderer imports - and it is the same resolver those two call.
 *
 * A literal, or a link that does not resolve, is emitted exactly as stored: a broken link is meant to
 * paint nothing and be reported by lint, not to be quietly swapped for a colour nobody chose.
 *
 * One consequence worth naming: `EffectsStackEditor`'s "custom CSS" escape hatch stores what this
 * returns, so converting a linked shadow to custom CSS bakes the colour in. That is the honest
 * outcome - a free-form CSS string has nowhere to keep a link - and it only happens when the author
 * deliberately leaves the structured model.
 */
export function shadowLayerDataToCss(layer: EffectShadowLayerData, mode: ShadowSerializeMode): string {
    const color = getActiveBrandPalette().resolveValueCss(layer.color) ?? layer.color;
    const sl = layerDataToShadowLike({ ...layer, color }, mode === "inner");
    return serializeShadowLikeLayer(sl, mode);
}

/** The widest spread drawn as rings; beyond it the outline would cost more shadows than it is worth. */
const TEXT_SHADOW_MAX_SPREAD = 24;
/** The most rings, and the most copies on one ring, a spread is drawn with. */
const TEXT_SHADOW_MAX_RINGS = 3;
const TEXT_SHADOW_MAX_RING_COPIES = 16;
const TEXT_SHADOW_MIN_RING_COPIES = 8;

function roundShadowPx(value: number): number {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * One layer as `text-shadow`, which - unlike `box-shadow` - takes no spread.
 *
 * A fourth length is not ignored by the browser: it makes the whole declaration invalid, so a text
 * shadow with any spread painted nothing at all, on the canvas and in the game alike. That is the
 * shadow authors reach for as an outline (no offset, no blur, a few pixels of spread), so the spread
 * is drawn the way `text-shadow` can draw it: copies of the glyphs at the layer's offset, pushed out
 * in a ring of directions at the spread's distance, each blurred by the layer's blur. Their union is
 * the glyphs grown by the spread. For a wider spread, inner rings fill what a single ring would leave
 * open around small marks such as a full stop.
 *
 * A spread of zero or less is the plain layer; text has nothing to shrink, so a negative spread is
 * left out rather than drawn as something else. The colour is resolved as `shadowLayerDataToCss`
 * resolves it.
 */
export function textShadowLayerDataToCss(layer: EffectShadowLayerData): string {
    const color = getActiveBrandPalette().resolveValueCss(layer.color) ?? layer.color;
    return textShadowLayerToCss({ ...layer, color });
}

function textShadowLayerToCss(layer: EffectShadowLayerData): string {
    const spread = Math.min(TEXT_SHADOW_MAX_SPREAD, layer.spread);
    if (!(spread > 0)) {
        return serializeShadowLikeLayer({ inset: false, ...layer, spread: 0 }, "outer");
    }
    const blur = Math.max(0, layer.blur);
    const rings = Math.min(TEXT_SHADOW_MAX_RINGS, Math.max(1, Math.ceil(spread / 2)));
    const copies: string[] = [];
    for (let ring = 1; ring <= rings; ring++) {
        const radius = (spread * ring) / rings;
        const count = Math.min(
            TEXT_SHADOW_MAX_RING_COPIES,
            Math.max(TEXT_SHADOW_MIN_RING_COPIES, Math.ceil((2 * Math.PI * radius) / 2)),
        );
        for (let step = 0; step < count; step++) {
            const angle = (2 * Math.PI * step) / count;
            const x = roundShadowPx(layer.offsetX + radius * Math.cos(angle));
            const y = roundShadowPx(layer.offsetY + radius * Math.sin(angle));
            copies.push(`${x}px ${y}px ${roundShadowPx(blur)}px ${layer.color}`);
        }
    }
    return copies.join(", ");
}

/** Splits a shadow list on its top-level commas, leaving the ones inside `rgba(…)` and the like. */
function splitShadowList(css: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < css.length; i++) {
        const ch = css[i];
        if (ch === "(") {
            depth += 1;
        } else if (ch === ")") {
            depth = Math.max(0, depth - 1);
        } else if (ch === "," && depth === 0) {
            parts.push(css.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(css.slice(start));
    return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * A free-form `text-shadow` value with every layer that carries a spread drawn as `text-shadow` can
 * draw it (see {@link textShadowLayerDataToCss}).
 *
 * Only a layer with a spread is rewritten; every other one - and any the parser does not read, such
 * as a colour written first - goes through exactly as typed, so a value that was valid stays valid.
 */
export function textShadowCssWithSpread(css: string): string {
    const trimmed = css.trim();
    if (!trimmed) {
        return "";
    }
    const layers = splitShadowList(trimmed);
    let rewritten = false;
    const out = layers.map(layer => {
        const parsed = parseShadowLikeFragment(layer);
        if (!parsed.ok || parsed.value.inset || parsed.value.spread === 0) {
            return layer;
        }
        rewritten = true;
        const { offsetX, offsetY, blur, spread, color } = parsed.value;
        return textShadowLayerToCss({ offsetX, offsetY, blur, spread, color });
    });
    return rewritten ? out.join(", ") : trimmed;
}
