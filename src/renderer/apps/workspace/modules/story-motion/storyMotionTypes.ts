import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

export const STORY_MOTION_KEYFRAME_SELECTION_TYPE = "storyMotionKeyframe";
export const STORY_MOTION_ASSET_SELECTION_TYPE = "storyMotion";

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

/**
 * A motion as a whole: what the inspector shows for a motion picked in the library, or for the
 * motion open in an editor when no keyframe is selected there.
 */
export type StoryMotionAssetSelection = {
    animationId: string;
};

export type StoryMotionKeyframeSelection = {
    editor: "story-motion";
    tabId: string;
    animationId: string;
    trackId: string;
    keyframeId: string;
};
