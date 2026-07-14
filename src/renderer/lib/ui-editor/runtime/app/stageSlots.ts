import type { UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";

export function findStageSurfaceForSlot(
    document: UIDocument,
    slotId: UIStageSlotId,
    logLabel: string,
): UIStageSurface | null {
    const matches = document.surfaces.filter((surface): surface is UIStageSurface =>
        surface.kind === "stageSurface" && surface.mount.slotId === slotId
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
