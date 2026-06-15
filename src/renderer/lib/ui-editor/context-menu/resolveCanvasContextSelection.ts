import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";

/**
 * Right-click on canvas: keep multi-select when hitting a selected node; otherwise focus the hit node only.
 * Blank right-click keeps the current UI element selection (for paste target / primary).
 */
export function resolveCanvasContextSelection(
    surfaceId: string,
    hitElementId: string | null,
    current: SelectionState,
): UIElementSelection | null {
    const ui =
        current.type === "element" && current.data && (current.data as UIElementSelection).editor === "ui"
            ? (current.data as UIElementSelection)
            : null;

    if (!hitElementId) {
        return ui && ui.surfaceId === surfaceId ? ui : null;
    }

    if (ui && ui.surfaceId === surfaceId && ui.elementIds.includes(hitElementId)) {
        return ui;
    }

    return {
        editor: "ui",
        surfaceId,
        elementIds: [hitElementId],
        primaryId: hitElementId,
    };
}

/**
 * Returns true if the canvas should update selection before showing the menu (hit outside current set).
 */
export function shouldApplyCanvasContextRetarget(
    surfaceId: string,
    hitElementId: string | null,
    current: SelectionState,
): boolean {
    const next = resolveCanvasContextSelection(surfaceId, hitElementId, current);
    if (!next) {
        return false;
    }
    const ui =
        current.type === "element" && current.data && (current.data as UIElementSelection).editor === "ui"
            ? (current.data as UIElementSelection)
            : null;
    if (!ui || ui.surfaceId !== surfaceId) {
        return true;
    }
    if (ui.elementIds.length !== next.elementIds.length) {
        return true;
    }
    const a = [...ui.elementIds].sort().join(",");
    const b = [...next.elementIds].sort().join(",");
    return a !== b;
}
