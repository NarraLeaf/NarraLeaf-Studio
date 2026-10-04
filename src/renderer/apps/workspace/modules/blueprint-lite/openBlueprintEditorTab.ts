import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import { translate } from "@/lib/i18n";
import { focusDetachedWindow } from "@/lib/components/layout";
import { Workflow } from "lucide-react";
import { createElement, type ReactNode } from "react";
import {
    isEditorDetached,
    releaseDetachedEditor,
    updateDetachedEditorPayload,
} from "@/apps/workspace/detached/detachedEditors";
import type { EditorTabDefinition } from "../../registry/types";
import { BlueprintEntryTab } from "./editors/BlueprintEntryTab";
import { getBlueprintEntryTabId, type BlueprintEntryTabPayload } from "./blueprintEntryTabId";

/**
 * Show a blueprint editor tab: open it, or - when that blueprint is already in a window of its
 * own - navigate that window instead.
 *
 * Opening a tab as well would leave two editors on one blueprint, and the one the author was sent
 * to - the node a diagnostic or a search result named, the graph a widget linked to - would be in
 * the other one. Every way into a blueprint editor goes through here for that reason: the entries
 * (`useOpenBlueprintTarget`), the search, problem and reference jumps, and a preview asking Studio
 * to show a node.
 */
export function showBlueprintEntryEditorTab(
    tab: EditorTabDefinition<BlueprintEntryTabPayload>,
    openEditorTab: (tab: EditorTabDefinition<BlueprintEntryTabPayload>) => void,
): void {
    if (tab.payload && isEditorDetached(tab.id)) {
        updateDetachedEditorPayload(tab.id, tab.payload);
        if (focusDetachedWindow(tab.id)) {
            return;
        }
        // The window went away without saying so. Fall through and dock it again rather than
        // navigate into nothing.
        releaseDetachedEditor(tab.id);
    }
    openEditorTab(tab);
}

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
