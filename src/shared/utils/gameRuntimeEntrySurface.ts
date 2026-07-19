import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";

/**
 * Entry-surface lookups shared by the runtime shells: the desktop shell sizes
 * and colors its BrowserWindow from these before first paint, and the web
 * export bakes the same values into its generated index.html - so both shells
 * show an identical pre-boot frame for the same pack.
 */

export function resolveGameRuntimeEntrySurface(pack: GameRuntimePackV1) {
    const surfaceId = pack.entry.kind === "surface" ? pack.entry.surfaceId : null;
    return surfaceId
        ? pack.bundle.ui.uidoc.surfaces.find(item => item.id === surfaceId)
        : pack.bundle.ui.uidoc.surfaces.find(item => item.kind === "appSurface");
}

/**
 * The shell background is visible until the renderer's first paint, so it
 * should match the entry surface instead of flashing black under a light UI.
 * Mirrors the renderer's surface background defaults: app surfaces are white
 * unless configured, stage surfaces are transparent - which has no opaque
 * equivalent and falls back to black, as does anything unparseable.
 */
export function resolveGameRuntimeInitialBackgroundColor(pack: GameRuntimePackV1): string {
    const surface = resolveGameRuntimeEntrySurface(pack);
    const configured = surface?.settings?.backgroundColor;
    if (typeof configured === "string" && configured.trim()) {
        return normalizeOpaqueBackgroundColor(configured) ?? "#000000";
    }
    return surface?.kind === "appSurface" ? "#ffffff" : "#000000";
}

/**
 * Normalize a CSS color to an opaque form both BrowserWindow and inline CSS
 * accept, or null. The output is always a `#rrggbb` hex or a bare lowercase
 * color name, so it is safe to interpolate into generated markup.
 */
export function normalizeOpaqueBackgroundColor(value: string): string | null {
    const color = value.trim().toLowerCase();
    if (!color || color === "transparent") {
        return null;
    }
    const hex = /^#([0-9a-f]{3,8})$/.exec(color)?.[1];
    if (hex) {
        if (hex.length === 3 || hex.length === 4) {
            if (hex.length === 4 && hex[3] === "0") {
                return null;
            }
            return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
        }
        if (hex.length === 6) {
            return `#${hex}`;
        }
        if (hex.length === 8) {
            // Fully transparent falls through to the default; a translucent
            // color keeps its RGB channels (the shell cannot blend anyway).
            return hex.slice(6) === "00" ? null : `#${hex.slice(0, 6)}`;
        }
        return null;
    }
    const fn = /^rgba?\(([^)]*)\)$/.exec(color);
    if (fn) {
        const parts = (fn[1] ?? "").split(",").map(part => Number(part.trim()));
        const [r, g, b, a] = parts;
        if (parts.length < 3 || [r, g, b].some(channel => !Number.isFinite(channel))) {
            return null;
        }
        if (parts.length >= 4 && !(Number.isFinite(a) && a! > 0)) {
            return null;
        }
        const toHex = (channel: number) =>
            Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0");
        return `#${toHex(r!)}${toHex(g!)}${toHex(b!)}`;
    }
    // Named CSS colors pass through; the consumer resolves them natively.
    return /^[a-z]+$/.test(color) ? color : null;
}
