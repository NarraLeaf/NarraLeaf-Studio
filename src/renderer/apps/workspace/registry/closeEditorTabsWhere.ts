import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { EditorLayout } from "./types";

/**
 * Close every editor tab whose id matches, in every group of the layout.
 *
 * For editors whose subject has just gone - a language removed from the list, a story deleted. A tab
 * left behind renders a subject that no longer exists under its old name, and its next edit is
 * written against nothing. The layout is walked rather than the focused group trusted, because the
 * same editor can be open in both panes of a split.
 *
 * Closed at the store, not through the registry's close: this is not the author closing a tab, so it
 * is not offered back by "reopen closed tab".
 */
export function closeEditorTabsWhere(uiService: UIService, matches: (tabId: string) => boolean): void {
    const found: Array<{ tabId: string; groupId: string }> = [];
    collect(uiService.getStore().getEditorLayout(), matches, found);
    for (const tab of found) {
        uiService.getStore().closeEditorTabInGroup(tab.tabId, tab.groupId);
    }
}

function collect(
    layout: Readonly<EditorLayout>,
    matches: (tabId: string) => boolean,
    acc: Array<{ tabId: string; groupId: string }>,
): void {
    if ("tabs" in layout) {
        for (const tab of layout.tabs) {
            if (matches(tab.id)) {
                acc.push({ tabId: tab.id, groupId: layout.id });
            }
        }
        return;
    }
    collect(layout.first, matches, acc);
    collect(layout.second, matches, acc);
}
