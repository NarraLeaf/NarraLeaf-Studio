import type { UISurface } from "@shared/types/ui-editor/document";

export const EDITOR_SURFACE_AREA_BACKGROUND = "#ffffff";
export const EDITOR_SURFACE_LOW_OPACITY_THRESHOLD = 0.2;
export const EDITOR_SURFACE_LOW_OPACITY_OUTLINE =
    "1px solid var(--narraleaf-accent-strong, rgba(64, 168, 196, 0.92))";

export function getSurfaceBackgroundColor(surface: UISurface): string {
    return surface.settings?.backgroundColor ?? (surface.kind === "stageSurface" ? "transparent" : "#ffffff");
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function parseAlpha(value: string | undefined): number | null {
    if (value === undefined) {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const alpha = trimmed.endsWith("%")
        ? Number(trimmed.slice(0, -1)) / 100
        : Number(trimmed);
    return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : null;
}

function parseFunctionalColorAlpha(value: string): number | null {
    const match = value.match(/^(?:rgb|hsl)a?\((.*)\)$/i);
    if (!match) {
        return null;
    }
    const body = match[1]?.trim() ?? "";
    if (body.includes("/")) {
        const alpha = body.split("/").pop();
        return parseAlpha(alpha);
    }
    const commaParts = body.split(",");
    if (commaParts.length >= 4) {
        return parseAlpha(commaParts[3]);
    }
    return 1;
}

export function getCssBackgroundAlpha(value: string | null | undefined): number {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized.length === 0 || normalized === "transparent") {
        return 0;
    }

    const hexBody = normalized.replace(/^#/, "");
    if (/^[0-9a-f]{4}$/.test(hexBody)) {
        return Number.parseInt(hexBody[3]!, 16) / 15;
    }
    if (/^[0-9a-f]{8}$/.test(hexBody)) {
        return Number.parseInt(hexBody.slice(6, 8), 16) / 255;
    }
    if (/^[0-9a-f]{3}$/.test(hexBody) || /^[0-9a-f]{6}$/.test(hexBody)) {
        return 1;
    }

    return parseFunctionalColorAlpha(normalized) ?? 1;
}

export function getSurfaceBackgroundAlpha(surface: UISurface): number {
    return getCssBackgroundAlpha(getSurfaceBackgroundColor(surface));
}

function isTransparentBackground(value: string | null | undefined): boolean {
    return getCssBackgroundAlpha(value) <= 0;
}

export function getEditorSurfaceAreaBackgroundColor(surface: UISurface): string | undefined {
    if (surface.kind !== "stageSurface") {
        return undefined;
    }
    return isTransparentBackground(surface.settings?.backgroundColor) ? EDITOR_SURFACE_AREA_BACKGROUND : undefined;
}

export function shouldShowEditorSurfaceLowOpacityOutline(surface: UISurface): boolean {
    return getSurfaceBackgroundAlpha(surface) < EDITOR_SURFACE_LOW_OPACITY_THRESHOLD;
}
