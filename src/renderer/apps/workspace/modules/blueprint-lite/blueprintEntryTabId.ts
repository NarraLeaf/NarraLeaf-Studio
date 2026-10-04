import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";

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
