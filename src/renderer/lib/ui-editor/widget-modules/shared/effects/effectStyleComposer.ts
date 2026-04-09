import type { CSSProperties } from "react";
import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { effectFilterStoredToCss, effectShadowStoredToCss } from "@shared/types/ui-editor/effects";

export type ComposedChromeEffectLayers = {
    /** Applied on chrome root (user outer + glow + inset shadows). */
    rootBoxShadow?: string;
    /** CSS filter on chrome root (blur + custom filter). */
    rootFilter?: string;
    backdropFilter?: string;
    mixBlendMode?: CSSProperties["mixBlendMode"];
};

/**
 * Build CSS layers from serialized effect values for rectangle chrome.
 * Stroke simulation uses a separate layer; user shadows here apply to the root chrome div.
 */
export function composeChromeEffectLayers(effects: ElementEffectValues): ComposedChromeEffectLayers {
    const outerParts = [
        effectShadowStoredToCss(effects.effectShadow, "outer"),
        effectShadowStoredToCss(effects.effectGlow, "glow"),
    ].filter(Boolean);
    const innerPart = effectShadowStoredToCss(effects.effectInnerShadow, "inner");
    let rootBoxShadow: string | undefined;
    if (outerParts.length && innerPart) {
        rootBoxShadow = `${outerParts.join(", ")}, ${innerPart}`;
    } else if (outerParts.length) {
        rootBoxShadow = outerParts.join(", ");
    } else if (innerPart) {
        rootBoxShadow = innerPart;
    }

    const blurPart = effects.effectBlur > 0 ? `blur(${effects.effectBlur}px)` : "";
    const extra = effectFilterStoredToCss(effects.effectFilter);
    const filterParts = [blurPart, extra].filter(Boolean);
    const rootFilter = filterParts.length > 0 ? filterParts.join(" ") : undefined;

    const backdropFilter =
        effects.effectBackgroundBlur > 0 ? `blur(${effects.effectBackgroundBlur}px)` : undefined;

    const blendRaw = effects.effectBlend.trim();
    const mixBlendMode = blendRaw ? (blendRaw as CSSProperties["mixBlendMode"]) : undefined;

    return {
        rootBoxShadow,
        rootFilter,
        backdropFilter,
        mixBlendMode,
    };
}

/** Merge user root box-shadow with an existing stroke-simulated inset on the same node (comma-separated). */
export function mergeBoxShadowLayers(user: string | undefined, strokeSimulatedInset: string | undefined): string | undefined {
    const u = user?.trim() ?? "";
    const s = strokeSimulatedInset?.trim() ?? "";
    if (u && s) {
        return `${u}, ${s}`;
    }
    if (u) {
        return u;
    }
    if (s) {
        return s;
    }
    return undefined;
}

export type TextEffectStyle = Pick<CSSProperties, "filter" | "mixBlendMode" | "textShadow">;

/** Map effects to text / textarea nodes (no backdrop blur on glyph run — omit background blur). */
export function composeTextEffectStyle(effects: ElementEffectValues): TextEffectStyle {
    const out: TextEffectStyle = {};
    const blurPart = effects.effectBlur > 0 ? `blur(${effects.effectBlur}px)` : "";
    const extra = effectFilterStoredToCss(effects.effectFilter);
    const filterParts = [blurPart, extra].filter(Boolean);
    if (filterParts.length > 0) {
        out.filter = filterParts.join(" ");
    }
    const blendRaw = effects.effectBlend.trim();
    if (blendRaw) {
        out.mixBlendMode = blendRaw as CSSProperties["mixBlendMode"];
    }
    const shadowParts = [
        effectShadowStoredToCss(effects.effectShadow, "outer"),
        effectShadowStoredToCss(effects.effectInnerShadow, "inner"),
        effectShadowStoredToCss(effects.effectGlow, "glow"),
    ].filter(Boolean);
    if (shadowParts.length > 0) {
        out.textShadow = shadowParts.join(", ");
    }
    return out;
}

export type ListHostEffectStyle = Pick<CSSProperties, "filter" | "backdropFilter" | "mixBlendMode" | "boxShadow">;

export function composeListHostEffectStyle(effects: ElementEffectValues): ListHostEffectStyle {
    const chrome = composeChromeEffectLayers(effects);
    const out: ListHostEffectStyle = {};
    if (chrome.rootFilter) {
        out.filter = chrome.rootFilter;
    }
    if (chrome.backdropFilter) {
        out.backdropFilter = chrome.backdropFilter;
    }
    if (chrome.mixBlendMode) {
        out.mixBlendMode = chrome.mixBlendMode;
    }
    if (chrome.rootBoxShadow) {
        out.boxShadow = chrome.rootBoxShadow;
    }
    return out;
}
