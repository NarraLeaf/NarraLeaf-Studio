import type { StoryId, StorySceneId } from "@shared/types/story";

export const STORY_SNAPSHOT_PANEL_ID = "narraleaf-studio:story-snapshots";

export type StorySnapshotPanelPayload = {
    tabId?: string;
    storyId: StoryId;
    sceneId: StorySceneId;
    storyName?: string;
    sceneName?: string;
};
