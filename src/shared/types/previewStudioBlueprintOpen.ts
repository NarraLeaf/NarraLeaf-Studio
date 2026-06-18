import type { UIElementId, UISurfaceId } from "./ui-editor/document";

/** Serializable payload: Dev Mode preview → Workspace blueprint editor tab. */
export type PreviewStudioBlueprintOpenPayload = {
    blueprintId: string;
    ownerKind: "surfaceMain" | "widgetMain" | "widgetValue";
    surfaceId: UISurfaceId;
    elementId?: UIElementId;
    propPath?: string;
    title?: string;
    focusEventId?: string;
    focusFunctionId?: string;
    focusFieldId?: string;
    focusNodeId?: string;
};
