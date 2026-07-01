import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

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
