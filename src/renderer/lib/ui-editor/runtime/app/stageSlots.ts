import type { UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";
import { stageMountSlotId } from "@shared/types/ui-editor/stageSlots";

export function findStageSurfaceForSlot(
    document: UIDocument,
    slotId: UIStageSlotId,
    logLabel: string,
): UIStageSurface | null {
    const matches = document.surfaces.filter((surface): surface is UIStageSurface =>
        surface.kind === "stageSurface" && stageMountSlotId(surface.mount) === slotId
    );
    if (matches.length > 1) {
        console.warn(
            `[${logLabel}][GameUI] Multiple active surfaces found for slot "${slotId}". ` +
            `Using the first surface in document order: ${matches[0]?.id ?? "(unknown)"}.`,
        );
    }
    return matches[0] ?? null;
}

export function stageSlotRuntimeScopeId(sessionId: string, slotId: UIStageSlotId, surfaceId: string): string {
    return `nlr:${sessionId}:slot:${slotId}:${surfaceId}`;
}

export function dialogSlotRuntimeScopeId(sessionId: string, surfaceId: string): string {
    return stageSlotRuntimeScopeId(sessionId, "dialog", surfaceId);
}

/**
 * The runtime scope of one *instance* of an element-mounted surface.
 *
 * Keyed on the stage object rather than on the surface, because the same surface may be on stage
 * more than once — two characters wearing the same avatar frame — and two instances sharing one
 * scope would share every piece of surface state the widgets inside them keep.
 */
export function stageElementRuntimeScopeId(sessionId: string, objectName: string, surfaceId: string): string {
    return `nlr:${sessionId}:element:${objectName}:${surfaceId}`;
}
