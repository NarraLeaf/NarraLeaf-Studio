import { formatBrandLink, parseBrandLink } from "@shared/brand/brandLink";
import { getActiveBrandPalette } from "@shared/brand/brandRegistry";
import type { ColorValue } from "../types";

/**
 * Reading and writing the colours a property field holds.
 *
 * **This module exists twice.** `src/runtime/renderer/shims/colorUtils.ts` is the same module for
 * the game runtime, aliased in by `project/build/build-runtime.js:69`, and the two must behave
 * identically - the editor and the shipped game paint from the same stored strings. Change one and
 * change the other, and keep both test files in step.
 *
 * Three functions carry the brand palette (`@shared/brand`), and they divide as read / paint /
 * write:
 *
 * - {@link parseColorValue} reads. A stored `nlbrand:` link comes back resolved, with the id kept
 *   alongside so the writer can put it back.
 * - {@link colorValueToCss} paints. Its answer is always something a browser can render.
 * - {@link serializeColorValue} writes. Its answer is what goes in the document - the link, if there
 *   is one, so that changing the palette still changes this field tomorrow.
 *
 * Comments in English per project convention.
 */

const RGBA_REGEX =
    /^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i;
const HEX_BODY_REGEX = /^[0-9a-fA-F]+$/;

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function normalizeHex(raw: string) {
    const cleaned = raw.trim().replace(/^#/, "");
    if (!HEX_BODY_REGEX.test(cleaned)) {
        return null;
    }
    if (cleaned.length === 3) {
        const expanded = cleaned
            .split("")
            .map((char) => char + char)
            .join("");
        return `#${expanded}`.toUpperCase();
    }
    if (cleaned.length === 6) {
        return `#${cleaned}`.toUpperCase();
    }
    return null;
}

export function normalizeHexInputDraft(raw: string) {
    const cleaned = raw
        .trim()
        .replace(/^#/, "")
        .replace(/[^0-9a-fA-F]/g, "")
        .slice(0, 6);
    return `#${cleaned}`.toUpperCase();
}

export function hexToRgb(hex: string) {
    const normalized = normalizeHex(hex);
    if (!normalized) {
        return { r: 255, g: 255, b: 255 };
    }
    const value = normalized.slice(1);
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return { r, g, b };
}

export function rgbToHex(r: number, g: number, b: number) {
    const componentToHex = (c: number) => {
        const hex = Math.round(clamp(c, 0, 255)).toString(16).padStart(2, "0");
        return hex;
    };
    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`.toUpperCase();
}

/**
 * A literal CSS colour as `{hex, alpha}`, or `null` when this parser cannot read it.
 *
 * Split out of {@link parseColorValue} so the brand path can tell "the palette resolved to something
 * unreadable" apart from "the caller's fallback" - the former must still hand the caller its own
 * fallback object back, unchanged. `transparent` keeps the caller's hex, which is why the hex to
 * fall back on is a parameter.
 */
function readLiteralColor(trimmed: string, fallbackHex: string): ColorValue | null {
    if (trimmed.toLowerCase() === "transparent") {
        return { hex: fallbackHex, alpha: 0 };
    }
    const match = trimmed.match(RGBA_REGEX);
    if (match) {
        const [, rawR, rawG, rawB, rawA] = match;
        const r = clamp(Number(rawR), 0, 255);
        const g = clamp(Number(rawG), 0, 255);
        const b = clamp(Number(rawB), 0, 255);
        const a = rawA === undefined ? 1 : clamp(Number(rawA), 0, 1);
        return {
            hex: rgbToHex(r, g, b),
            alpha: a,
        };
    }
    const hexBody = trimmed.replace(/^#/, "");
    if (/^[0-9a-fA-F]{8}$/.test(hexBody)) {
        const r = Number.parseInt(hexBody.slice(0, 2), 16);
        const g = Number.parseInt(hexBody.slice(2, 4), 16);
        const b = Number.parseInt(hexBody.slice(4, 6), 16);
        const aByte = Number.parseInt(hexBody.slice(6, 8), 16);
        return {
            hex: rgbToHex(r, g, b),
            alpha: clamp(aByte / 255, 0, 1),
        };
    }
    const normalized = normalizeHex(trimmed);
    if (normalized) {
        return {
            hex: normalized,
            alpha: 1,
        };
    }
    return null;
}

/**
 * What a stored value paints as, read through the same literal parser as everything else.
 *
 * The palette answers with a CSS literal that already carries the right opacity, so `{hex, alpha}`
 * here is only a re-reading of that one string. **The alpha rule is not restated at this layer** -
 * see `BrandPalette.resolveValueCss` - because two copies of it are what let the canvas and the
 * shipped game disagree about the same document.
 */
function readBrandValue(value: string, fallbackHex: string): ColorValue | null {
    const resolved = getActiveBrandPalette().resolveValueCss(value);
    return resolved === null ? null : readLiteralColor(resolved.trim(), fallbackHex);
}

/**
 * What a brand id paints as: the entry read as a stored value with no alpha segment of its own,
 * which is what a `ColorValue` holding a `link` stands for - its alpha lives in the value, not in
 * the id.
 */
function readBrandColor(id: string, fallbackHex: string): ColorValue | null {
    return readBrandValue(formatBrandLink(id), fallbackHex);
}

/**
 * A stored colour string as `{hex, alpha}`, plus `link` when it pointed at the project palette.
 *
 * **An unresolvable link is handed the caller's fallback, with no `link` on it.** A broken or
 * circular id is a string this parser does not recognise, and the fallback is what an unrecognised
 * string has always produced here - keeping the id would offer the rest of Studio a reference to
 * something that does not paint.
 *
 * Alpha comes back inside the palette's answer rather than being worked out here: the whole stored
 * string goes to `BrandPalette.resolveValueCss`, and both the hue and the opacity are read off the
 * literal it returns. That is what makes the number this field shows the number the document holds.
 */
export function parseColorValue(raw: string | undefined, fallback: ColorValue): ColorValue {
    if (!raw) {
        return fallback;
    }
    const trimmed = raw.trim();
    const link = parseBrandLink(trimmed);
    if (link) {
        const base = readBrandValue(trimmed, fallback.hex);
        if (!base) {
            return fallback;
        }
        return {
            hex: base.hex,
            alpha: base.alpha ?? 1,
            link: link.id,
        };
    }
    return readLiteralColor(trimmed, fallback.hex) ?? fallback;
}

/**
 * The value as CSS a browser can paint. Never a link.
 *
 * A link's hue is re-read from the palette rather than taken from `value.hex`, so a caller still
 * holding a `ColorValue` parsed before the author changed the brand paints the new colour rather
 * than the old one. The alpha is `value.alpha` as given: that is the author's setting for this
 * field, and re-reading it from the palette would throw away an explicit `/<alpha>` override.
 */
export function colorValueToCss(value: ColorValue) {
    const linked = value.link ? readBrandColor(value.link, value.hex) : null;
    const normalized = normalizeHex(linked?.hex ?? value.hex) || "#FFFFFF";
    const { r, g, b } = hexToRgb(normalized);
    const alpha = clamp(value.alpha ?? 1, 0, 1);
    if (alpha >= 1) {
        return normalized;
    }
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/**
 * The value as it should be stored.
 *
 * The same string as {@link colorValueToCss} for an ordinary colour; the link for a value that has
 * one, so the field keeps following the palette instead of being frozen at whatever the palette
 * happened to say the day it was saved.
 *
 * **An alpha that merely restates the palette entry's own is written as no alpha at all.** For a
 * translucent entry (`button.shadow` is `rgba(0, 0, 0, 0.35)`) {@link parseColorValue} hands back
 * `alpha: 0.35`, and writing that straight out would turn `nlbrand:button.shadow` into
 * `nlbrand:button.shadow/0.35` the first time the author touched the field - pinning a number they
 * never chose, and unpinning the shadow from the brand. Only an alpha that differs from the entry's
 * is an override worth recording.
 *
 * The awkward case that falls out of that rule is "this translucent brand colour, but opaque": no
 * segment already means "inherit", so full opacity has to be written as `/1` or the slider springs
 * back to the entry's own alpha the next time the field is read. `writeOpaqueSegment` says it out
 * loud, and it is asked for only here because this is the only place that knows the entry's alpha.
 */
export function serializeColorValue(value: ColorValue): string {
    if (value.link) {
        const alpha = clamp(value.alpha ?? 1, 0, 1);
        const own = readBrandColor(value.link, value.hex)?.alpha ?? 1;
        if (Math.abs(own - alpha) < 1e-3) {
            return formatBrandLink(value.link);
        }
        return formatBrandLink(value.link, alpha, { writeOpaqueSegment: true });
    }
    return colorValueToCss({ hex: value.hex, alpha: value.alpha });
}
