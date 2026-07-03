import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

export const STORY_MOTION_KEYFRAME_SELECTION_TYPE = "storyMotionKeyframe";

export type StoryMotionActionContext = {
    storyId: StoryId;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
    storyName?: string;
    sceneName?: string;
};

export type StoryMotionPanelPayload = Partial<StoryMotionActionContext>;

export type StoryMotionEditorPayload = {
    animationId: string;
    actionContext?: StoryMotionActionContext;
};

export type StoryMotionKeyframeSelection = {
    editor: "story-motion";
    tabId: string;
    animationId: string;
    trackId: string;
    keyframeId: string;
};

export function isStoryMotionKeyframeSelectionData(value: unknown): value is StoryMotionKeyframeSelection {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    return record.editor === "story-motion"
        && typeof record.tabId === "string"
        && typeof record.animationId === "string"
        && typeof record.trackId === "string"
        && typeof record.keyframeId === "string";
}
