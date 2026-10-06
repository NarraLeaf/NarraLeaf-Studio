import type { UIStore } from "@/lib/workspace/services/ui/UIStore";
import type { StoryPreviewHub } from "./preview/storyPreviewHub";
import {
    discardPendingStoryActionCreateRequests,
    type StoryActionCreatorPanelPayload,
} from "./storyActionCreatorEvents";

/** How the command manual is put on the rail, pointed at another scene, and taken off again. */
export type StoryCommandManualRail = {
    /** Put the manual on the rail; the returned function takes it off. */
    register: (payload: StoryActionCreatorPanelPayload) => () => void;
    /** Point the manual, already on the rail, at another scene tab. */
    retarget: (payload: StoryActionCreatorPanelPayload) => void;
};

/**
 * Keep the command manual on the rail for as long as any story scene tab is open, pointed at the one
 * the author was in last, until the returned function is called.
 *
 * "The one the author was in last" is the floating preview's answer to the same question, read off
 * the same hub, so the manual and the preview never disagree about which scene is the scene. The hub
 * holds that answer through other editors coming to the front, which is exactly what the manual has to
 * survive: a look at a blueprint is not the end of writing the scene.
 *
 * Requests the manual sent to a tab that has since closed are forgotten here, so the same scene
 * opened again later does not open with a line nobody asked it for.
 */
export function holdStoryCommandManualOnRail(
    hub: Pick<StoryPreviewHub, "getTarget" | "subscribe">,
    store: Pick<UIStore, "getEvents" | "getEditorTabs">,
    rail: StoryCommandManualRail,
): () => void {
    let unregister: (() => void) | null = null;
    let targetTabId: string | null = null;

    const sync = () => {
        const next = hub.getTarget();
        if (next === targetTabId) {
            return;
        }
        targetTabId = next;
        if (!next) {
            unregister?.();
            unregister = null;
            return;
        }
        if (unregister) {
            rail.retarget({ tabId: next });
        } else {
            unregister = rail.register({ tabId: next });
        }
    };

    sync();
    const unsubscribeHub = hub.subscribe(sync);
    const unsubscribeLayout = store.getEvents().on("editorLayoutChanged", () => {
        const open = new Set(store.getEditorTabs().map(tab => tab.id));
        discardPendingStoryActionCreateRequests(tabId => open.has(tabId));
    });
    return () => {
        unsubscribeHub();
        unsubscribeLayout();
        unregister?.();
        unregister = null;
        targetTabId = null;
    };
}
