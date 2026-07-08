import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

/**
 * Persisted layout of the story editor's live-preview pane. One global key (not per-scene):
 * pane visibility and width are a workbench preference that applies to every scene editor.
 */
export type StoryScenePreviewPaneState = {
    open: boolean;
    width: number;
};

const STORY_PREVIEW_PANE_STATE_KEY = "story:editor:preview";

export const STORY_PREVIEW_PANE_MIN_WIDTH = 280;
export const STORY_PREVIEW_PANE_DEFAULT_WIDTH = 420;
/** The pane may take at most this fraction of the editor's width. */
export const STORY_PREVIEW_PANE_MAX_FRACTION = 0.7;

export function getStoryScenePreviewPaneState(panelState: PanelStateService): StoryScenePreviewPaneState {
    const stored = panelState.getPanelState<Partial<StoryScenePreviewPaneState>>(STORY_PREVIEW_PANE_STATE_KEY);
    return {
        open: stored?.open === true,
        width: typeof stored?.width === "number" && Number.isFinite(stored.width)
            ? Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, stored.width)
            : STORY_PREVIEW_PANE_DEFAULT_WIDTH,
    };
}

export function patchStoryScenePreviewPaneState(panelState: PanelStateService, patch: Partial<StoryScenePreviewPaneState>): void {
    panelState.setPanelState<Partial<StoryScenePreviewPaneState>>(STORY_PREVIEW_PANE_STATE_KEY, patch);
}
