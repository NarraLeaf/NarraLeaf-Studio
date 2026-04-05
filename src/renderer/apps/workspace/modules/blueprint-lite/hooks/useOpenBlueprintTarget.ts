import { useCallback } from "react";
import { useRegistry } from "@/apps/workspace/registry";
import { BlueprintEntryTab } from "../editors/BlueprintEntryTab";
import { getBlueprintEntryTabId, type BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";

/**
 * Open or focus the blueprint editor tab with a unified navigation payload.
 */
export function useOpenBlueprintTarget() {
    const { openEditorTab } = useRegistry();

    return useCallback(
        (target: BlueprintEditorOpenTarget) => {
            const tabId = getBlueprintEntryTabId({
                blueprintId: target.blueprintId,
                surfaceId: target.surfaceId,
                elementId: target.elementId,
            });
            const payload: BlueprintEntryTabPayload = {
                blueprintId: target.blueprintId,
                ownerKind: target.ownerKind,
                surfaceId: target.surfaceId,
                elementId: target.elementId,
                focusEventId: target.focusEventId,
                focusFunctionId: target.focusFunctionId,
                focusDeclarationId: target.focusDeclarationId,
                focusNodeId: target.focusNodeId,
            };
            openEditorTab({
                id: tabId,
                title: target.title ?? "Visual Blueprint",
                component: BlueprintEntryTab,
                payload,
                closable: true,
            });
        },
        [openEditorTab],
    );
}
