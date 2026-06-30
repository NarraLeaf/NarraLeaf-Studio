import type { UISurface } from "@shared/types/ui-editor/document";

export const EDITOR_SURFACE_AREA_BACKGROUND = "#ffffff";

export function getSurfaceBackgroundColor(surface: UISurface): string {
    return surface.settings?.backgroundColor ?? (surface.kind === "stageSurface" ? "transparent" : "#ffffff");
}

function isTransparentBackground(value: string | null | undefined): boolean {
    const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
    return (
        normalized.length === 0 ||
        normalized === "transparent" ||
        normalized === "#0000" ||
        normalized === "#00000000" ||
        normalized === "rgba(0,0,0,0)" ||
        normalized === "hsla(0,0%,0%,0)"
    );
}

export function getEditorSurfaceAreaBackgroundColor(surface: UISurface): string | undefined {
    if (surface.kind !== "stageSurface") {
        return undefined;
    }
    return isTransparentBackground(surface.settings?.backgroundColor) ? EDITOR_SURFACE_AREA_BACKGROUND : undefined;
}
