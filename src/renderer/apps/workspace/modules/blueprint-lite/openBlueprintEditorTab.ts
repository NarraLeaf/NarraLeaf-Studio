import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import type { EditorTabDefinition } from "../../registry/types";
import { BlueprintEntryTab } from "./editors/BlueprintEntryTab";
import { getBlueprintEntryTabId, type BlueprintEntryTabPayload } from "./blueprintEntryTabId";

export function createBlueprintEntryEditorTab(
    target: BlueprintEditorOpenTarget,
): EditorTabDefinition<BlueprintEntryTabPayload> {
    const tabId = getBlueprintEntryTabId({
        blueprintId: target.blueprintId,
        surfaceId: target.surfaceId,
        elementId: target.elementId,
        propPath: target.propPath,
    });
    const payload: BlueprintEntryTabPayload = {
        blueprintId: target.blueprintId,
        ownerKind: target.ownerKind,
        surfaceId: target.surfaceId,
        elementId: target.elementId,
        propPath: target.propPath,
        focusEventId: target.focusEventId,
        focusFunctionId: target.focusFunctionId,
        focusFieldId: target.focusFieldId,
        focusNodeId: target.focusNodeId,
    };
    return {
        id: tabId,
        title: target.title ?? "Visual Blueprint",
        component: BlueprintEntryTab,
        payload,
        closable: true,
    };
}
