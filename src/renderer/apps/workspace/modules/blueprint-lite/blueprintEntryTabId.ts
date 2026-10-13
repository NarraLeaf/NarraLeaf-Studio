import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";

export type BlueprintEntryOwnerKind =
    | "globalMain"
    | "surfaceMain"
    | "widgetMain"
    | "widgetValue"
    | "componentWidgetMain"
    | "storyAction";

/** Payload for blueprint entry tab (M4-lite → M4-full); extended with editor focus fields. */
export type BlueprintEntryTabPayload = {
    blueprintId: string;
    ownerKind: BlueprintEntryOwnerKind;
    /** Absent for surface-less owners (e.g. storyAction). */
    surfaceId?: UISurfaceId;
    componentId?: string;
    elementId?: UIElementId;
    propPath?: string;
    focusEventId?: string;
    focusFunctionId?: string;
    focusFieldId?: string;
    focusNodeId?: string;
};

/** Every blueprint editor tab's id starts with this. */
const BLUEPRINT_ENTRY_TAB_PREFIX = "blueprint-entry:";

export function getBlueprintEntryTabId(parts: {
    blueprintId: string;
    surfaceId?: UISurfaceId;
    elementId?: UIElementId;
    propPath?: string;
}): string {
    return `${BLUEPRINT_ENTRY_TAB_PREFIX}${parts.blueprintId}:${parts.surfaceId ?? "~"}:${parts.elementId ?? "~"}:${parts.propPath ?? "~"}`;
}

/**
 * Whether `tab` is a blueprint editor tab showing `blueprintId`.
 *
 * Read from the payload rather than rebuilt with {@link getBlueprintEntryTabId}, because the same
 * blueprint can be open under more than one id: the inspector, the blueprint wall and search each
 * open it with the owner parts they hold.
 */
export function isBlueprintEntryTabShowing(tab: { id: string; payload?: unknown }, blueprintId: string): boolean {
    if (!tab.id.startsWith(BLUEPRINT_ENTRY_TAB_PREFIX)) {
        return false;
    }
    const payload = tab.payload as Partial<BlueprintEntryTabPayload> | undefined;
    return payload?.blueprintId === blueprintId;
}

/**
 * What opens the blueprint `payload` shows again where the author left it: the same owner, under
 * `title`, on the layer that was open.
 *
 * Handed across whenever an editor moves between a tab and a window of its own. The open layer goes
 * with it; a node or field to bring into view does not - that is a one-off request the editor has
 * already acted on, and repeating it would move the view the author has since set.
 */
export function blueprintTargetKeepingLayer(payload: BlueprintEntryTabPayload, title: string): BlueprintEditorOpenTarget {
    return {
        blueprintId: payload.blueprintId,
        ownerKind: payload.ownerKind,
        surfaceId: payload.surfaceId,
        componentId: payload.componentId,
        elementId: payload.elementId,
        propPath: payload.propPath,
        title,
        ...(payload.focusEventId ? { focusEventId: payload.focusEventId } : {}),
        ...(payload.focusFunctionId ? { focusFunctionId: payload.focusFunctionId } : {}),
    };
}
