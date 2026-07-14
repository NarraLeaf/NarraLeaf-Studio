import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

/** Docked into the split-pane, or popped out as a free-floating picture-in-picture window. */
export type StoryScenePreviewPaneMode = "dock" | "float";

/** Floating-window geometry, in editor-body-relative pixels. */
export type StoryScenePreviewFloatRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * Persisted layout of the story editor's live-preview pane. One global key (not per-scene):
 * pane visibility, docked width, and picture-in-picture placement are a workbench preference
 * that applies to every scene editor.
 */
export type StoryScenePreviewPaneState = {
    open: boolean;
    width: number;
    mode: StoryScenePreviewPaneMode;
    /** Null until the pane has been popped out at least once. */
    float: StoryScenePreviewFloatRect | null;
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
/** Gap kept between an auto-placed floating window and the editor body edge. */
const STORY_PREVIEW_FLOAT_MARGIN = 24;

export const DEFAULT_STORY_SCENE_PREVIEW_PANE_STATE: StoryScenePreviewPaneState = {
    open: false,
    width: STORY_PREVIEW_PANE_DEFAULT_WIDTH,
    mode: "dock",
    float: null,
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

export function getStoryScenePreviewPaneState(panelState: PanelStateService): StoryScenePreviewPaneState {
    const stored = panelState.getPanelState<Partial<StoryScenePreviewPaneState>>(STORY_PREVIEW_PANE_STATE_KEY);
    return {
        open: stored?.open === true,
        width: typeof stored?.width === "number" && Number.isFinite(stored.width)
            ? Math.max(STORY_PREVIEW_PANE_MIN_WIDTH, stored.width)
            : STORY_PREVIEW_PANE_DEFAULT_WIDTH,
        mode: stored?.mode === "float" ? "float" : "dock",
        float: parseFloatRect(stored?.float),
    };
}

export function patchStoryScenePreviewPaneState(panelState: PanelStateService, patch: Partial<StoryScenePreviewPaneState>): void {
    panelState.setPanelState<Partial<StoryScenePreviewPaneState>>(STORY_PREVIEW_PANE_STATE_KEY, patch);
}

/** Auto-placement for a freshly popped-out window: anchored to the bottom-right of the editor body. */
export function createDefaultStoryPreviewFloatRect(bounds: { width: number; height: number } | null): StoryScenePreviewFloatRect {
    const width = STORY_PREVIEW_FLOAT_DEFAULT_WIDTH;
    const height = STORY_PREVIEW_FLOAT_DEFAULT_HEIGHT;
    if (!bounds || bounds.width < 1 || bounds.height < 1) {
        return { x: STORY_PREVIEW_FLOAT_MARGIN, y: STORY_PREVIEW_FLOAT_MARGIN, width, height };
    }
    const w = Math.min(width, bounds.width);
    const h = Math.min(height, bounds.height);
    return {
        x: Math.max(0, bounds.width - w - STORY_PREVIEW_FLOAT_MARGIN),
        y: Math.max(0, bounds.height - h - STORY_PREVIEW_FLOAT_MARGIN),
        width: w,
        height: h,
    };
}
