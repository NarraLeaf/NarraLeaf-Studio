import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { translate } from "@/lib/i18n";
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
        // A caller with nothing better to call the tab gets the generic name, in the interface's
        // language - a literal here put the English word on the tab strip of every locale.
        title: target.title ?? translate("blueprint.tab.title"),
        icon: blueprintEntryTabIcon(),
        component: BlueprintEntryTab,
        payload,
        closable: true,
    };
}
