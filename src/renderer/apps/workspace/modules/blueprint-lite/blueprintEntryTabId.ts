import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";

export type BlueprintEntryOwnerKind = "surfaceMain" | "widgetMain";

/** Payload for M4-lite entry tab; stable for future M4-full editor handoff. */
export type BlueprintEntryTabPayload = {
    blueprintId: string;
    ownerKind: BlueprintEntryOwnerKind;
    surfaceId: UISurfaceId;
    elementId?: UIElementId;
    focusEventId?: string;
};

export function getBlueprintEntryTabId(parts: {
    blueprintId: string;
    surfaceId: UISurfaceId;
    elementId?: UIElementId;
}): string {
    return `blueprint-entry:${parts.blueprintId}:${parts.surfaceId}:${parts.elementId ?? "~"}`;
}
