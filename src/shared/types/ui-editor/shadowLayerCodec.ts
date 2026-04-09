/**
 * Parse/serialize single box-shadow / text-shadow fragments for stored effect layers.
 * Shared between editor UI and runtime CSS composition (no React).
 */

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

export function shadowLayerDataToCss(layer: EffectShadowLayerData, mode: ShadowSerializeMode): string {
    const sl = layerDataToShadowLike(layer, mode === "inner");
    return serializeShadowLikeLayer(sl, mode);
}
