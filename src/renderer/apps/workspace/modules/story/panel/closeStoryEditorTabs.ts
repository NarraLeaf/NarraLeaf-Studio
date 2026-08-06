import type { StoryId, StorySceneId } from "@shared/types/story";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { EditorLayout } from "../../../registry/types";
import { getSceneFlowTabId } from "../../story-flow/sceneFlowTabId";
import { getStorySceneEditorTabId } from "../scene-editor/storySceneEditorTabId";

/**
 * Closing the editors that a story deletion leaves without a subject.
 *
 * A tab left behind is not merely untidy: an editor renders from a document that no longer holds
 * what the tab names, so it shows an empty shell under the deleted thing's name, and its next edit
 * would write against an id nothing points at.
 *
 * **None of this is part of the undo entry, and that is deliberate.** Undo restores documents;
 * which tabs are open is workspace state, and an author does not expect Ctrl+Z to re-open windows.
 *
 * Everything here walks the layout rather than trusting a tab id to be in the *current* group: the
 * same scene can be open in two panes of a split, and closing only the focused one leaves the other
 * showing something that was just deleted.
 */

/** Close the editors for the named scenes of one story. */
export function closeStorySceneEditorTabs(
    uiService: UIService,
    storyId: StoryId,
    sceneIds: readonly StorySceneId[],
): void {
    if (sceneIds.length === 0) {
        return;
    }
    const wanted = new Set(sceneIds.map(sceneId => getStorySceneEditorTabId(storyId, sceneId)));
    closeMatchingEditorTabs(uiService, tabId => wanted.has(tabId));
}

/**
 * Close every editor belonging to one story: all of its scenes, and its flow map.
 *
 * Matched by id prefix rather than by asking the document which scenes it had, because the caller
 * may not have loaded it - and a story being deleted is exactly the case where reading it to find
 * out what to close is the wrong way round. Story ids are UUIDs, so the prefix cannot collide.
 */
export function closeStoryEditorTabs(uiService: UIService, storyId: StoryId): void {
    const scenePrefix = getStorySceneEditorTabId(storyId, "" as StorySceneId);
    const flowTabId = getSceneFlowTabId(storyId);
    closeMatchingEditorTabs(uiService, tabId => tabId === flowTabId || tabId.startsWith(scenePrefix));
}

function closeMatchingEditorTabs(uiService: UIService, matches: (tabId: string) => boolean): void {
    const found: Array<{ tabId: string; groupId: string }> = [];
    collectEditorTabs(uiService.getStore().getEditorLayout(), matches, found);
    for (const tab of found) {
        uiService.getStore().closeEditorTabInGroup(tab.tabId, tab.groupId);
    }
}

function collectEditorTabs(
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
    collectEditorTabs(layout.first, matches, acc);
    collectEditorTabs(layout.second, matches, acc);
}
