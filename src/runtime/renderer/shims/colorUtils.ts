type ColorValue = {
    hex: string;
    alpha?: number;
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

export function parseColorValue(raw: string | undefined, fallback: ColorValue): ColorValue {
    if (!raw) {
        return fallback;
    }
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "transparent") {
        return { hex: fallback.hex, alpha: 0 };
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
    return fallback;
}

export function colorValueToCss(value: ColorValue): string {
    const normalized = normalizeHex(value.hex) || "#FFFFFF";
    const { r, g, b } = hexToRgb(normalized);
    const alpha = clamp(value.alpha ?? 1, 0, 1);
    if (alpha >= 1) {
        return normalized;
    }
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}
