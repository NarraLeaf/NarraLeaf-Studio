import type { CSSProperties } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    EDITOR_SURFACE_LOW_OPACITY_OUTLINE,
    getEditorSurfaceAreaBackgroundColor,
    shouldShowEditorSurfaceLowOpacityOutline,
} from "@/lib/ui-editor/runtime/surfaceBackground";
import { ZOOMED_TRANSPARENCY_BACKDROP } from "@/styles/transparencyBackdrop";

/**
 * The editing canvas draws past the frame's edge, which a game and a placement clip at: an element
 * moved off the page has to stay somewhere the author can see and grab it. `SurfaceOffPageVeil` is
 * what marks that part as off the page.
 */
const EDITOR_SURFACE_OVERFLOW: CSSProperties = { overflow: "visible" };

export function getEditorSurfaceStyle(surface: UISurface | null | undefined, isComponentEdit: boolean): CSSProperties | undefined {
    if (!surface) {
        return undefined;
    }
    if (isComponentEdit) {
        // A component is drawn at its own size and paints no background (the adapter makes its
        // surface transparent), so what the frame shows between its widgets is what a placement lets
        // through: the page it is put on. The squares say so, and mark where the component ends.
        return { ...ZOOMED_TRANSPARENCY_BACKDROP, ...EDITOR_SURFACE_OVERFLOW };
    }
    const backgroundColor = getEditorSurfaceAreaBackgroundColor(surface);
    const style: CSSProperties = { ...EDITOR_SURFACE_OVERFLOW };
    if (backgroundColor) {
        style.backgroundColor = backgroundColor;
    }
    if (shouldShowEditorSurfaceLowOpacityOutline(surface)) {
        style.outline = EDITOR_SURFACE_LOW_OPACITY_OUTLINE;
        style.outlineOffset = "0px";
    }
    return style;
}
