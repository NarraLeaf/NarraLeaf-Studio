import { formatBrandLink, parseBrandLink } from "@shared/brand/brandLink";
import { getActiveBrandPalette } from "@shared/brand/brandRegistry";

/**
 * The game runtime's copy of the property-framework colour helpers, aliased in by
 * `project/build/build-runtime.js:69`.
 *
 * **It must behave exactly like the editor's copy**
 * (`src/renderer/apps/workspace/modules/properties/framework/utils/colorUtils.ts`) - the two read the
 * same stored strings, and a shipped game that resolved a brand link differently from the editor
 * would look wrong only after it was built. Change one, change the other; the doc comments on the
 * three brand-aware functions live over there, and both test files assert the same cases.
 *
 * The brand registry is reached through `@shared`, which is the one Studio-side tree this bundle may
 * import (`@/…` is rejected by the alias plugin), so both hosts read one implementation of the
 * palette rather than two.
 *
 * Comments in English per project convention.
 */

type ColorValue = {
    hex: string;
    alpha?: number;
    /** The brand id this value points at; `hex`/`alpha` still hold the resolved colour. */
    link?: string;
};

const RGBA_REGEX =
    /^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i;
const HEX_BODY_REGEX = /^[0-9a-fA-F]+$/;

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function normalizeHex(raw: string): string | null {
    const cleaned = raw.trim().replace(/^#/, "");
    if (!HEX_BODY_REGEX.test(cleaned)) {
        return null;
    }
    if (cleaned.length === 3) {
        const expanded = cleaned
            .split("")
            .map(char => char + char)
            .join("");
        return `#${expanded}`.toUpperCase();
    }
    if (cleaned.length === 6) {
        return `#${cleaned}`.toUpperCase();
    }
    return null;
}

export function normalizeHexInputDraft(raw: string): string {
    const cleaned = raw
        .trim()
        .replace(/^#/, "")
        .replace(/[^0-9a-fA-F]/g, "")
        .slice(0, 6);
    return `#${cleaned}`.toUpperCase();
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = normalizeHex(hex);
    if (!normalized) {
        return { r: 255, g: 255, b: 255 };
    }
    const value = normalized.slice(1);
    return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
    };
}

export function rgbToHex(r: number, g: number, b: number): string {
    const componentToHex = (component: number) => Math.round(clamp(component, 0, 255)).toString(16).padStart(2, "0");
    return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`.toUpperCase();
}

/** A literal CSS colour, or `null` when this parser cannot read it. `transparent` keeps the caller's hex. */
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
 * What a stored value paints as, read through the same literal parser as everything else. The
 * palette's answer already carries the right opacity; the alpha rule is not restated here.
 */
function readBrandValue(value: string, fallbackHex: string): ColorValue | null {
    const resolved = getActiveBrandPalette().resolveValueCss(value);
    return resolved === null ? null : readLiteralColor(resolved.trim(), fallbackHex);
}

/** What a brand id paints as: the entry as a stored value with no alpha segment of its own. */
function readBrandColor(id: string, fallbackHex: string): ColorValue | null {
    return readBrandValue(formatBrandLink(id), fallbackHex);
}

/**
 * A stored colour string as `{hex, alpha}`, plus `link` when it pointed at the project palette.
 * An unresolvable link yields the caller's fallback, with no `link` on it.
 *
 * Both the hue and the opacity are read off the literal `BrandPalette.resolveValueCss` returns for
 * the whole stored string. See the editor copy, and that method, for why the alpha rule lives there.
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

/** The value as CSS a browser can paint. Never a link. A link's hue is re-read from the palette. */
export function colorValueToCss(value: ColorValue): string {
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
 * The value as it should be stored: the link if it has one, otherwise the same CSS as above.
 *
 * An alpha that merely restates the entry's own is written as no segment, so touching a field does
 * not pin a number the author never chose. Full opacity in front of a *translucent* entry is the
 * exception and has to be written as `/1`, because no segment means "inherit" rather than "opaque".
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
