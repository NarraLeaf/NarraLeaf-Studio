import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";

/**
 * A `/jump` the editor should open with **typed but not committed**.
 *
 * The scene flow map's connect gesture. Drawing a line between two boxes is a statement about the
 * story, and the map refuses to make it on the author's behalf: the jump is written where jumps are
 * written, in the scene editor, with its surrounding control flow visible and the caret already on
 * it. Enter commits it; Escape leaves the story exactly as the author found it — which is what keeps
 * the map an honest reading of the document rather than a second place the story is edited.
 */
export type StorySceneEditorDraftJump = {
    targetSceneId: StorySceneId;
    /**
     * The container the line belongs inside — a choice option or a condition arm, when the gesture
     * started on that arm's row. Absent means the end of the scene.
     */
    insideBlockId?: StoryBlockId;
    /**
     * Makes each gesture distinct. Re-opening an already-open tab replaces its payload, and two
     * drags to the same scene are two requests; without this the second one would be indistinguishable
     * from the first and silently do nothing.
     */
    token: number;
};

export type StorySceneEditorTabPayload = {
    storyId: StoryId;
    sceneId: StorySceneId;
    activeBlockId?: StoryBlockId;
    /**
     * Makes a repeated navigation to the SAME row a second request.
     *
     * Re-opening an already-open tab replaces its payload, and the target alone cannot tell one ask
     * apart from the one before it — so without this, "take me to the line that is playing", asked
     * twice while the game sits on that line, would land the second time on wherever the author had
     * scrolled to since. Same reason {@link StorySceneEditorDraftJump.token} exists.
     *
     * Optional because most callers navigate to a row the author picked out of a list, and picking
     * the same row twice is one destination asked for twice.
     */
    revealToken?: number;
    draftJump?: StorySceneEditorDraftJump;
};

/**
 * The next {@link StorySceneEditorTabPayload.revealToken}.
 *
 * ONE counter for every caller, and that is the whole point of it living here rather than in each of
 * them. The editor marks a navigation handled by `blockId#token`, so two callers counting separately
 * hand out the same key for the same row — a search hit for a line the Dev Mode timeline had already
 * opened arrived as "already handled" and did nothing. Caught on the real app; a caller-local counter
 * looks correct in isolation and can only fail against another caller.
 */
let revealTokenSeq = 0;

export function nextStoryRevealToken(): number {
    revealTokenSeq += 1;
    return revealTokenSeq;
}

export function getStorySceneEditorTabId(storyId: StoryId, sceneId: StorySceneId): string {
    return `story:scene:${storyId}:${sceneId}`;
}
