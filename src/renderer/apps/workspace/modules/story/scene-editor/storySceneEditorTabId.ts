import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

export type StorySceneEditorTabPayload = {
    storyId: StoryId;
    sceneId: StorySceneId;
    activeBlockId?: StoryBlockId;
};

export function getStorySceneEditorTabId(storyId: StoryId, sceneId: StorySceneId): string {
    return `story:scene:${storyId}:${sceneId}`;
}
