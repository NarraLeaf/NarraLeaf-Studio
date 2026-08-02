import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

/**
 * `SelectionState.type` for "a story scene editor owns the right rail".
 *
 * Declared here rather than in `UIStore` for the same reason `storyMotionKeyframe` is declared in the
 * story-motion module: the store's union names the *kinds* of selection, and the shape of each one
 * belongs to the editor that publishes it.
 */
export const STORY_BLOCK_SELECTION_TYPE = "storyBlock";

/**
 * What a story scene editor publishes as the app-wide selection.
 *
 * `blockId` is null when no row is focused — the scene itself is then the subject, and the properties
 * panel renders the scene's own fields. That is deliberately *one* selection member rather than two:
 * the rail always has a subject while a scene tab is in front, so there is no third "nothing" state to
 * fall into and no empty panel to explain.
 *
 * The payload is an address, not content: the block and the callbacks that edit it travel through the
 * per-tab bridge (`storyInspectorBridge`), which republishes as the document changes. Putting a
 * `StoryBlock` in here would have the panel render a snapshot frozen at the moment of selection.
 */
export type StoryBlockSelection = {
    editor: "story";
    tabId: string;
    storyId: StoryId;
    sceneId: StorySceneId;
    /** The focused row, or null when the scene itself is the subject. */
    blockId: StoryBlockId | null;
};

export function isStoryBlockSelectionData(value: unknown): value is StoryBlockSelection {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return record.editor === "story"
        && typeof record.tabId === "string"
        && typeof record.storyId === "string"
        && typeof record.sceneId === "string"
        && (record.blockId === null || typeof record.blockId === "string");
}

/** Whether two published selections address the same thing (used to avoid redundant store writes). */
export function isSameStoryBlockSelection(a: StoryBlockSelection, b: StoryBlockSelection): boolean {
    return a.tabId === b.tabId && a.storyId === b.storyId && a.sceneId === b.sceneId && a.blockId === b.blockId;
}
