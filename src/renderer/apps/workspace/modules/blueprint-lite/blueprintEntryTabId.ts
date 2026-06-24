import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";

export type BlueprintEntryOwnerKind =
    | "globalMain"
    | "surfaceMain"
    | "widgetMain"
    | "widgetValue"
    | "componentWidgetMain";

/** Payload for blueprint entry tab (M4-lite → M4-full); extended with editor focus fields. */
export type BlueprintEntryTabPayload = {
    blueprintId: string;
    ownerKind: BlueprintEntryOwnerKind;
    surfaceId: UISurfaceId;
    componentId?: string;
    elementId?: UIElementId;
    propPath?: string;
    focusEventId?: string;
    focusFunctionId?: string;
    focusFieldId?: string;
    focusNodeId?: string;
};

export function getBlueprintEntryTabId(parts: {
    blueprintId: string;
    surfaceId: UISurfaceId;
    elementId?: UIElementId;
    propPath?: string;
}): string {
    return `blueprint-entry:${parts.blueprintId}:${parts.surfaceId}:${parts.elementId ?? "~"}:${parts.propPath ?? "~"}`;
}
