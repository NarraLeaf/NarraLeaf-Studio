import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

/** Docked into the scene editor, or popped out as a free-floating picture-in-picture window. */
export type StoryScenePreviewPaneMode = "dock" | "float";

/**
 * Floating-window geometry, in pixels relative to the top-left corner of the workspace's content
 * area - everything between the title bar and the status bar, docks included.
 */
export type StoryScenePreviewFloatRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * What a stored float rect is measured against.
 *
 * `workspace` is the content area above. `editorBody` is what builds before the window belonged to
 * the workspace measured it against: the scene editor's body, which the window could not leave.
 * Those builds wrote no frame at all, so a record without one is an editor-body rect; see
 * `migrateEditorBodyStoryPreviewFloatRect`.
 */
export type StoryScenePreviewFloatFrame = "workspace" | "editorBody";

/**
 * Persisted layout of the story editor's live-preview pane. One per-project key (not per-scene):
 * pane visibility, docked width, and picture-in-picture placement are a workbench preference that
 * applies to every scene editor.
 */
export type StoryScenePreviewPaneState = {
    open: boolean;
    width: number;
    mode: StoryScenePreviewPaneMode;
    /** Null until the pane has been popped out at least once. */
    float: StoryScenePreviewFloatRect | null;
    floatFrame: StoryScenePreviewFloatFrame;
};

const STORY_PREVIEW_PANE_STATE_KEY = "story:editor:preview";

export const STORY_PREVIEW_PANE_MIN_WIDTH = 280;
export const STORY_PREVIEW_PANE_DEFAULT_WIDTH = 420;
/** The docked pane may take at most this fraction of the editor's width. */
export const STORY_PREVIEW_PANE_MAX_FRACTION = 0.7;

export const STORY_PREVIEW_FLOAT_MIN_WIDTH = 260;
export const STORY_PREVIEW_FLOAT_MIN_HEIGHT = 180;
export const STORY_PREVIEW_FLOAT_DEFAULT_WIDTH = 420;
export const STORY_PREVIEW_FLOAT_DEFAULT_HEIGHT = 300;

export const DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE: StoryScenePreviewPaneState = {
    open: false,
    width: STORY_PREVIEW_PANE_DEFAULT_WIDTH,
    mode: "dock",
    float: null,
    floatFrame: "workspace",
};

function parseFloatRect(value: unknown): StoryScenePreviewFloatRect | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const rect = value as Partial<StoryScenePreviewFloatRect>;
    const numbers = [rect.x, rect.y, rect.width, rect.height];
    if (!numbers.every(n => typeof n === "number" && Number.isFinite(n))) {
        return null;
    }
    return {
        x: rect.x as number,
        y: rect.y as number,
        width: Math.max(STORY_PREVIEW_FLOAT_MIN_WIDTH, rect.width as number),
        height: Math.max(STORY_PREVIEW_FLOAT_MIN_HEIGHT, rect.height as number),
    };
}

/** Read the stored record, filling in whatever an older build (or a hand edit) left out. */
export function parseStoryScenePreviewPaneState(stored: Partial<StoryScenePreviewPaneState> | undefined): StoryScenePreviewPaneState {
    const float = parseFloatRect(stored?.float);
    return {
        open: stored?.open === true,
        width: typeof stored?.width === "number" && Number.isFinite(stored.width)
            ? Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, stored.width)
            : STORY_PREVIEW_PANE_DEFAULT_WIDTH,
        mode: stored?.mode === "float" ? "float" : "dock",
        float,
        // Only a rect has a frame to be read in; with none there is nothing to carry over.
        floatFrame: float === null || stored?.floatFrame === "workspace" ? "workspace" : "editorBody",
    };
}

export function getStoryScenePreviewPaneState(panelState: PanelStateService): StoryScenePreviewPaneState {
    return parseStoryScenePreviewPaneState(
        panelState.getPanelState<Partial<StoryScenePreviewPaneState>>(STORY_PREVIEW_PANE_STATE_KEY),
    );
}

export function patchStoryScenePreviewPaneState(panelState: PanelStateService, patch: Partial<StoryScenePreviewPaneState>): void {
    panelState.setPanelState<Partial<StoryScenePreviewPaneState>>(STORY_PREVIEW_PANE_STATE_KEY, patch);
}
