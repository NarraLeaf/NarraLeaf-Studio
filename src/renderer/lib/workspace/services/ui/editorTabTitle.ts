import type { UIService } from "../core/UIService";

/**
 * Re-title an open editor tab after whatever it is showing was renamed.
 *
 * A tab's title is a *snapshot* taken when it was opened - it has to be, because a tab definition is
 * a plain object the layout stores, not a live view of the scene, character or asset behind it. So a
 * rename anywhere else left the tab still saying the old name until it was closed and reopened.
 *
 * Addresses the tab by id alone: the store finds the group holding it, which a tab dragged into a
 * second pane needs and the calling editor cannot answer.
 *
 * Callers pass the title they want shown. An empty one is ignored rather than drawn: a tab with no
 * name is unclickable in a way a stale name is not.
 */
export function syncEditorTabTitle(uiService: UIService | null | undefined, tabId: string, title: string): void {
    if (!uiService || !title) {
        return;
    }
    uiService.getStore().updateEditorTab(tabId, { title });
}
