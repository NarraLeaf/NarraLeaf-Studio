import type { StoryId, StorySceneId } from "@shared/types/story";

export const STORY_VARIABLES_PANEL_ID = "narraleaf-studio:story-variables";

export type StoryVariablesPanelPayload = {
    tabId?: string;
    storyId: StoryId;
    sceneId: StorySceneId;
    storyName?: string;
    sceneName?: string;
};
