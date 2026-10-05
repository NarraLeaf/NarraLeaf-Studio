import type { CSSProperties } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    EDITOR_SURFACE_LOW_OPACITY_OUTLINE,
    shouldShowEditorSurfaceLowOpacityOutline,
} from "@/lib/ui-editor/runtime/surfaceBackground";
import { ZOOMED_TRANSPARENCY_BACKDROP } from "@/styles/transparencyBackdrop";

/**
 * The editing canvas draws past the frame's edge, which a game and a placement clip at: an element
 * moved off the page has to stay somewhere the author can see and grab it. `SurfaceOffPageVeil` is
 * what marks that part as off the page.
 */
const EDITOR_SURFACE_OVERFLOW: CSSProperties = { overflow: "visible" };

/**
 * What the editing canvas adds to a surface's own frame.
 *
 * No fill: the frame paints the surface's own background and nothing else (`BrandedSurfaceFrame`
 * writes it over any colour handed in here), so a transparent Game UI surface shows the canvas behind
 * it - and with it any other Game UI drawn under it as a reference. A transparent surface is marked by
 * its outline instead.
 */
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
    const style: CSSProperties = { ...EDITOR_SURFACE_OVERFLOW };
    if (shouldShowEditorSurfaceLowOpacityOutline(surface)) {
        style.outline = EDITOR_SURFACE_LOW_OPACITY_OUTLINE;
        style.outlineOffset = "0px";
    }
    return style;
}
