import type { StoryId, StorySceneId } from "@shared/types/story";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { EditorLayout } from "../../../registry/types";
import { getStorySceneEditorTabId } from "./storySceneEditorTabId";

/**
 * Close every open editor for the named scenes.
 *
 * For deletions that take scenes with them. A tab left behind is not merely untidy: the scene
 * editor renders from a document that no longer has that scene, so the tab shows an empty shell
 * under the deleted scene's name, and its next edit would write against an id nothing holds.
 *
 * Walks the layout rather than trusting the tab id to be in the *current* group: the same scene can
 * be open in two panes of a split, and closing only the focused one leaves the other showing the
 * scene that was just deleted.
 *
 * Deliberately not part of the undo entry. Undo restores documents; which tabs are open is view
 * state, and re-opening editors the author had not asked for would be a second surprise on top of
 * the one they asked to take back.
 */
export function closeStorySceneEditorTabs(
    uiService: UIService,
    storyId: StoryId,
    sceneIds: readonly StorySceneId[],
): void {
    if (sceneIds.length === 0) {
        return;
    }
    const wanted = new Set(sceneIds.map(sceneId => getStorySceneEditorTabId(storyId, sceneId)));
    const found: Array<{ tabId: string; groupId: string }> = [];
    collectStorySceneEditorTabs(uiService.getStore().getEditorLayout(), wanted, found);
    for (const tab of found) {
        uiService.getStore().closeEditorTabInGroup(tab.tabId, tab.groupId);
    }
}

function collectStorySceneEditorTabs(
    layout: Readonly<EditorLayout>,
    wanted: ReadonlySet<string>,
    acc: Array<{ tabId: string; groupId: string }>,
): void {
    if ("tabs" in layout) {
        for (const tab of layout.tabs) {
            if (wanted.has(tab.id)) {
                acc.push({ tabId: tab.id, groupId: layout.id });
            }
        }
        return;
    }
    collectStorySceneEditorTabs(layout.first, wanted, acc);
    collectStorySceneEditorTabs(layout.second, wanted, acc);
}
