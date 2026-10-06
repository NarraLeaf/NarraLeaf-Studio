import type { StoryBlockId, StoryDocument, StoryId, StoryScene } from "@shared/types/story";
import { listScenesInDocumentOrder } from "@shared/types/story/order";
import type { UIStageSlotId } from "@shared/types/ui-editor/document";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { createStorySceneEditorTab } from "../openStorySceneEditorTab";
import { getStoryEditorViewState, patchStoryEditorViewState } from "../storyEditorSessionStore";
import { getStorySceneEditorTabId } from "../storySceneEditorTabId";
import { getStoryPreviewHub, type StoryPreviewHub } from "./storyPreviewHub";
import { findStorySceneTab } from "./storyPreviewFloatOwner";
import { createDefaultStoryPreviewFloatRect } from "./storyPreviewFloatGeometry";
import type { StoryScenePreviewFloatRect } from "./storyScenePreviewSessionStore";
import { findStoryPreviewRowForSlot, storyPreviewCanShowSlot } from "./storyPreviewSlotRows";

export type ShowGameUiInStoryPreviewResult = "shown" | "noRow";

/**
 * Show a Game UI in the floating live preview, from an editor that is not a scene editor.
 *
 * The floating preview always shows one scene editor's scene at that editor's cursor; this keeps it
 * so and only chooses the row. The scene it already shows is kept when it has a row that shows this
 * Game UI: the cursor stays where it is if its row shows it, and otherwise steps to the next row that
 * does. Failing that, the first scene that has one - the default story first, its entry scene first -
 * is opened behind the editor the request came from, with its cursor on that row, and the preview
 * follows it. Nothing is written to the project: a cursor is view state.
 *
 * `noRow` when no row of any story shows this Game UI; the preview is left as it was.
 */
export async function showGameUiInStoryPreview(input: {
    context: WorkspaceContext;
    slotId: UIStageSlotId;
    /** The editor group a scene editor opened for this goes into. */
    groupId: string | null;
    /**
     * Where the window opens if it has never been opened, in the area's coordinates: the top-right
     * corner of this box, or of the whole area when there is no box to read.
     */
    anchor: (area: HTMLElement | null) => StoryScenePreviewFloatRect | null;
}): Promise<ShowGameUiInStoryPreviewResult> {
    const { context, slotId, groupId, anchor } = input;
    if (!storyPreviewCanShowSlot(slotId)) {
        return "noRow";
    }
    const hub = getStoryPreviewHub(context);
    const store = context.services.get<UIService>(Services.UI).getStore();
    const stories = context.services.get<StoryService>(Services.Story);
    const panelState = context.services.get<PanelStateService>(Services.PanelState);

    const cursorOf = (sceneId: string): StoryBlockId | null => {
        const published = hub.getCursor(sceneId);
        return published !== undefined ? published : getStoryEditorViewState(panelState, sceneId)?.activeBlockId ?? null;
    };
    /** Move a scene's cursor the way a press on the floating stage does. */
    const step = (tabId: string, sceneId: string, blockId: StoryBlockId) => {
        const handle = hub.getTab(tabId);
        if (handle) {
            handle.stepTo(blockId);
            return;
        }
        patchStoryEditorViewState(panelState, sceneId, { activeBlockId: blockId, selectedBlockIds: [blockId], scroll: undefined });
        hub.publishCursor(sceneId, blockId);
    };

    const shown = findStorySceneTab(store.getEditorLayout(), hub.getTarget());
    if (shown) {
        const scene = (await loadStory(stories, shown.payload.storyId))?.scenes[shown.payload.sceneId];
        const cursor = cursorOf(shown.payload.sceneId);
        const row = scene ? findStoryPreviewRowForSlot(scene, cursor, slotId, hub.getTab(shown.tabId)?.isRowShown) : null;
        if (row) {
            if (row !== cursor) {
                step(shown.tabId, shown.payload.sceneId, row);
            }
            openFloatingPreview(hub, anchor);
            return "shown";
        }
    }

    for (const storyId of storySearchOrder(stories)) {
        const document = await loadStory(stories, storyId);
        for (const scene of document ? sceneSearchOrder(document) : []) {
            if (scene.id === shown?.payload.sceneId) {
                continue;
            }
            const tabId = getStorySceneEditorTabId(storyId, scene.id);
            const open = findStorySceneTab(store.getEditorLayout(), tabId);
            const cursor = open ? cursorOf(scene.id) : null;
            const row = findStoryPreviewRowForSlot(scene, cursor, slotId, hub.getTab(tabId)?.isRowShown);
            if (!row) {
                continue;
            }
            if (open) {
                if (row !== cursor) {
                    step(tabId, scene.id, row);
                }
            } else {
                // Written before the tab exists, so the editor opens on the row when it is first shown.
                step(tabId, scene.id, row);
                store.openEditorTabInGroup(createStorySceneEditorTab({ storyId, sceneId: scene.id }, scene.name), groupId ?? undefined, false);
            }
            hub.noteFocused(tabId);
            openFloatingPreview(hub, anchor);
            return "shown";
        }
    }
    return "noRow";
}

function openFloatingPreview(hub: StoryPreviewHub, anchor: (area: HTMLElement | null) => StoryScenePreviewFloatRect | null): void {
    if (hub.getLayout().float !== null) {
        hub.patchLayout({ open: true, mode: "float" });
        return;
    }
    const area = hub.getArea();
    const areaBox = area?.getBoundingClientRect();
    const bounds = areaBox && areaBox.width >= 1 && areaBox.height >= 1
        ? { width: Math.floor(areaBox.width), height: Math.floor(areaBox.height) }
        : null;
    hub.patchLayout({
        open: true,
        mode: "float",
        float: createDefaultStoryPreviewFloatRect(bounds, anchor(area), "top-right"),
    });
}

async function loadStory(stories: StoryService, storyId: StoryId): Promise<StoryDocument | null> {
    try {
        return await stories.loadStory(storyId);
    } catch {
        return null;
    }
}

/** The default story, where the game starts, then the rest of the library in its order. */
function storySearchOrder(stories: StoryService): StoryId[] {
    const ids = stories.listStories().map(story => story.id);
    const first = stories.getDefaultStoryId();
    return first && ids.includes(first) ? [first, ...ids.filter(id => id !== first)] : ids;
}

/** The scene the story starts in, then every scene in the order the author reads them. */
function sceneSearchOrder(document: StoryDocument): StoryScene[] {
    const scenes = listScenesInDocumentOrder(document);
    const entry = document.entrySceneId ? document.scenes[document.entrySceneId] : undefined;
    return entry ? [entry, ...scenes.filter(scene => scene.id !== entry.id)] : scenes;
}
