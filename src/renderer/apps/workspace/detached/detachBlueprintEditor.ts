import { useCallback } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { focusDetachedWindow } from "@/lib/components/layout";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintEditorOpenTarget } from "@/lib/workspace/services/ui-editor/blueprint/navigationTargets";
import type { EditorLayout } from "@/apps/workspace/registry/types";
import { createBlueprintEntryEditorTab } from "../modules/blueprint-lite/openBlueprintEditorTab";
import { detachEditor, isEditorDetached, updateDetachedEditorPayload } from "./detachedEditors";

/**
 * Open a blueprint straight into a window of its own, skipping the tab.
 *
 * The same destination the pop-out control reaches from inside the editor, entered from outside it:
 * every blueprint entry (the interface's logic card, a widget's, a story action's) opens in a window
 * on a right click. One function so both routes agree on what a detached editor is called, what
 * happens to a tab that is already open on it, and what a second request for one does.
 */
export function useDetachBlueprintEditor(): (target: BlueprintEditorOpenTarget) => void {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();

    return useCallback(
        (target: BlueprintEditorOpenTarget) => {
            if (!isInitialized || !context) {
                return;
            }

            const tab = createBlueprintEntryEditorTab(target);
            if (!tab.payload) {
                return;
            }

            // Already in a window: bring it forward with whatever the caller wanted focused, rather
            // than opening a second view onto one blueprint.
            if (isEditorDetached(tab.id)) {
                updateDetachedEditorPayload(tab.id, tab.payload);
                focusDetachedWindow(tab.id);
                return;
            }

            const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            const blueprintName = localBp.getBlueprintDocument().blueprints[target.blueprintId]?.name;
            const tabTitle = target.title ?? String(tab.title);

            detachEditor({
                kind: "blueprint",
                tabId: tab.id,
                // The two words the editor's own title row shows, so the window is recognisable as
                // the blueprint it holds. The tab's name is the fallback for a blueprint that does
                // not exist yet - the story-action cards create theirs on the way in.
                title: blueprintName ? `${t("blueprint.header.title")} ${blueprintName}` : tabTitle,
                // Kept so closing the window can put back the tab under the name it would have had:
                // this editor is opened under several (the blueprint's own, the widget it belongs
                // to, the story action that calls it).
                tabTitle,
                payload: tab.payload,
            });

            // A tab already open on this blueprint would be a second editor on it. Detaching from
            // inside the editor closes its own tab for the same reason.
            const store = context.services.get<UIService>(Services.UI).getStore();
            const groupId = findEditorGroupIdForTab(store.getEditorLayout(), tab.id);
            if (groupId) {
                store.closeEditorTabInGroup(tab.id, groupId);
            }
        },
        [context, isInitialized, t],
    );
}

/** The group a tab lives in, or null when no group holds it. */
export function findEditorGroupIdForTab(layout: Readonly<EditorLayout>, tabId: string): string | null {
    if ("tabs" in layout) {
        return layout.tabs.some(tab => tab.id === tabId) ? layout.id : null;
    }
    return findEditorGroupIdForTab(layout.first, tabId) ?? findEditorGroupIdForTab(layout.second, tabId);
}

/** The tab strip's own name for a tab, so a detached editor can be restored under it. */
export function findEditorTabTitle(layout: Readonly<EditorLayout>, tabId: string): string | null {
    if ("tabs" in layout) {
        return layout.tabs.find(tab => tab.id === tabId)?.title ?? null;
    }
    return findEditorTabTitle(layout.first, tabId) ?? findEditorTabTitle(layout.second, tabId);
}
