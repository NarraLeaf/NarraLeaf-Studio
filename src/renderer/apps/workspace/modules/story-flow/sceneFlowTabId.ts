import type { StoryId, StorySceneId } from "@shared/types/story";

export type SceneFlowViewport = { x: number; y: number; zoom: number };

export type SceneFlowTabPayload = {
    storyId: StoryId;
    /**
     * Nodes the author dragged, overriding the auto-layout. Lives on the tab payload rather than the
     * story document so arranging the map never dirties the story or needs a schema bump.
     */
    positions?: Record<StorySceneId, { x: number; y: number }>;
    viewport?: SceneFlowViewport;
};

/** One flow map per story, so re-opening focuses the existing tab instead of duplicating it. */
export function getSceneFlowTabId(storyId: StoryId): string {
    return `story:flow:${storyId}`;
}
