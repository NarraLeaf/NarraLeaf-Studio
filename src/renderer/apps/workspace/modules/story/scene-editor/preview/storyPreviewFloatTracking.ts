import type { UIStore } from "@/lib/workspace/services/ui/UIStore";
import type { FocusManager } from "@/lib/workspace/services/ui/FocusManager";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { EditorLayout } from "../../../../registry/types";
import { isStorySceneEditorTabId } from "../storySceneEditorTabId";
import type { StoryPreviewHub } from "./storyPreviewHub";

/** The tab a group is showing, for focus that lands on the group's tab strip. */
function groupFocus(layout: EditorLayout, groupId: string): string | null {
    if ("tabs" in layout) {
        return layout.id === groupId ? layout.focus : null;
    }
    return groupFocus(layout.first, groupId) ?? groupFocus(layout.second, groupId);
}

/**
 * Feed the hub the order in which story scene tabs take focus, for as long as the returned function
 * has not been called.
 *
 * Focus reaches a tab four ways, and each is heard: it is opened in front, it is picked in its strip,
 * the workspace hands it focus (a tab closed next to it, a restored session), or the author clicks
 * into its body - the one way the workspace's own tab history does not record, and the one that
 * decides between two scenes side by side in a split.
 */
export function trackStoryPreviewFloatOwner(
    ui: { store: UIStore; focus: FocusManager },
    hub: StoryPreviewHub,
): () => void {
    const { store, focus } = ui;
    const noteIfStory = (tabId: string | null | undefined) => {
        if (tabId && isStorySceneEditorTabId(tabId)) {
            hub.noteFocused(tabId);
        }
    };
    // The workspace's own "last focused tab" moves on every path that changes which tab a group
    // shows. It is heard when it changes, not on every layout event, so an unrelated layout write
    // (a title, a dirty flag) cannot take the window back from a split pane the author clicked into.
    let lastFocusedKey: string | null = null;
    const sync = () => {
        hub.reconcile(store.getEditorTabsByRecency().map(tab => tab.id).filter(isStorySceneEditorTabId));
        const last = store.getLastFocusedEditorTab();
        const key = last ? `${last.groupId}\n${last.tabId}` : null;
        if (key !== lastFocusedKey) {
            lastFocusedKey = key;
            noteIfStory(last?.tabId);
        }
    };
    sync();
    const events = store.getEvents();
    const unsubscribers = [
        events.on("editorTabOpenedInGroup", ({ tab, activated }) => {
            if (activated) {
                noteIfStory(tab.id);
            }
        }),
        events.on("editorTabActivatedInGroup", ({ tabId }) => noteIfStory(tabId)),
        events.on("editorLayoutChanged", sync),
        focus.onFocusChange(context => {
            if (context.area === FocusArea.Editor) {
                noteIfStory(context.targetId);
            } else if (context.area === FocusArea.EditorTabs && context.targetId) {
                noteIfStory(groupFocus(store.getEditorLayout(), context.targetId));
            }
        }),
    ];
    return () => {
        for (const unsubscribe of unsubscribers) {
            unsubscribe();
        }
    };
}
