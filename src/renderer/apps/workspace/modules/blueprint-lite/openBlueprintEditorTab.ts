import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { Workflow } from "lucide-react";
import { createElement, type ReactNode } from "react";
import type { EditorTabDefinition } from "../../registry/types";
import { BlueprintEntryTab } from "./editors/BlueprintEntryTab";
import { getBlueprintEntryTabId, type BlueprintEntryTabPayload } from "./blueprintEntryTabId";

/**
 * The glyph every blueprint tab wears, whatever its owner kind. Shared with session restore so a
 * restored graph tab is indistinguishable from a freshly opened one.
 */
export function blueprintEntryTabIcon(): ReactNode {
    return createElement(Workflow, { className: "w-4 h-4" });
}

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
        componentId: target.componentId,
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
        icon: blueprintEntryTabIcon(),
        component: BlueprintEntryTab,
        payload,
        closable: true,
    };
}
