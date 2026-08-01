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
    /**
     * Scenes drawn with their fork arms showing. Same reasoning as `positions` — which boxes are
     * open is how one author is reading the map, not a fact about the story.
     *
     * An **array**, not a `Set`: the payload is persisted as JSON on the UI store, and a `Set`
     * round-trips as `{}`. The tab rehydrates it into a set for the model and the canvas, which must
     * be handed the same one or the layout packs boxes the renderer then draws at another size.
     */
    expandedSceneIds?: StorySceneId[];
};

/** One flow map per story, so re-opening focuses the existing tab instead of duplicating it. */
export function getSceneFlowTabId(storyId: StoryId): string {
    return `story:flow:${storyId}`;
}
