import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";
import type { BlueprintEntryOwnerKind } from "@/apps/workspace/modules/blueprint-lite/blueprintEntryTabId";

/**
 * Navigation target for opening / focusing the Blueprint entry tab (M4-full).
 */
export type BlueprintEditorOpenTarget = {
    blueprintId: string;
    ownerKind: BlueprintEntryOwnerKind;
    surfaceId: UISurfaceId;
    componentId?: string;
    elementId?: UIElementId;
    propPath?: string;
    /** Optional tab title when opening from workspace. */
    title?: string;
    /** Focus an event graph by id */
    focusEventId?: string;
    /** Focus a function graph by id */
    focusFunctionId?: string;
    /** Focus a field in the member tree / inspector */
    focusFieldId?: string;
    /** Focus a node on the current graph canvas */
    focusNodeId?: string;
};
