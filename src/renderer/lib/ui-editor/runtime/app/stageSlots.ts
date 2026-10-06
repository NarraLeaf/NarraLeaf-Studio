import type { UIDocument, UIStageSlotId, UIStageSurface } from "@shared/types/ui-editor/document";

function stageSurfacesForSlot(document: UIDocument, slotId: UIStageSlotId): UIStageSurface[] {
    return document.surfaces.filter((surface): surface is UIStageSurface =>
        surface.kind === "stageSurface" && surface.mount.slotId === slotId
    );
}

/**
 * The surface a game draws in a slot: the first one in document order that names it.
 *
 * The same answer {@link findStageSurfaceForSlot} gives, without its warning, for a reader that asks on
 * every render - the UI editor showing what the game would put beside the surface being edited.
 */
export function selectStageSurfaceForSlot(document: UIDocument, slotId: UIStageSlotId): UIStageSurface | null {
    return stageSurfacesForSlot(document, slotId)[0] ?? null;
}

export function findStageSurfaceForSlot(
    document: UIDocument,
    slotId: UIStageSlotId,
    logLabel: string,
): UIStageSurface | null {
    const matches = stageSurfacesForSlot(document, slotId);
    if (matches.length > 1) {
        console.warn(
            `[${logLabel}][GameUI] Multiple active surfaces found for slot "${slotId}". ` +
            `Using the first surface in document order: ${matches[0]?.id ?? "(unknown)"}.`,
        );
    }
    return matches[0] ?? null;
}

/**
 * The blueprint scope one drawing of a slot surface runs in.
 *
 * `slot` is which drawing, for the one slot that can have several at once: the engine renders a
 * choice surface per menu the scene is showing. Slot zero is spelled without a suffix, so a game
 * that draws each slot once - which is every game that has no concurrent menus - keeps the scope
 * id, and with it the widget keys and surface state, that it has always had. Same rule as a widget
 * address with no instance on it.
 */
export function stageSlotRuntimeScopeId(
    sessionId: string,
    slotId: UIStageSlotId,
    surfaceId: string,
    slot = 0,
): string {
    const base = `nlr:${sessionId}:slot:${slotId}:${surfaceId}`;
    return slot > 0 ? `${base}:#${slot}` : base;
}

export function dialogSlotRuntimeScopeId(sessionId: string, surfaceId: string): string {
    return stageSlotRuntimeScopeId(sessionId, "dialog", surfaceId);
}
