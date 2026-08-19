import type { EditorGroup, EditorLayout, EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { UIService } from "../core/UIService";

/** The open tab with this id, and the group holding it - a tab dragged aside is not in the active one. */
export function findEditorTabInLayout(
    layout: EditorLayout | null | undefined,
    tabId: string,
): { tab: EditorTabDefinition<unknown>; groupId: string } | null {
    if (!layout) {
        return null;
    }
    if ("tabs" in layout) {
        const group = layout as EditorGroup;
        const tab = group.tabs.find(candidate => candidate.id === tabId);
        return tab ? { tab: tab as EditorTabDefinition<unknown>, groupId: group.id } : null;
    }
    return findEditorTabInLayout(layout.first, tabId) ?? findEditorTabInLayout(layout.second, tabId);
}

/**
 * Re-title an open editor tab after whatever it is showing was renamed.
 *
 * A tab's title is a *snapshot* taken when it was opened - it has to be, because a tab definition is
 * a plain object the layout stores, not a live view of the scene, character or asset behind it. So a
 * rename anywhere else left the tab still saying the old name until it was closed and reopened.
 *
 * Goes through the layout rather than `EditorService.update`, because that one writes the flat legacy
 * `editorTabs` list while what the tab strip renders comes from `editorLayout` - nothing has written
 * that list since tabs moved into groups, so `editor.update({ title })` is silently a no-op.
 * Re-opening with `activate: false` is the store's own in-place update path.
 *
 * Callers pass the title they want shown. An empty one is ignored rather than drawn: a tab with no
 * name is unclickable in a way a stale name is not.
 */
export function syncEditorTabTitle(uiService: UIService | null | undefined, tabId: string, title: string): void {
    if (!uiService || !title) {
        return;
    }
    const store = uiService.getStore();
    const found = findEditorTabInLayout(store.getEditorLayout(), tabId);
    if (!found || found.tab.title === title) {
        return;
    }
    store.openEditorTabInGroup({ ...found.tab, title }, found.groupId, false);
}
