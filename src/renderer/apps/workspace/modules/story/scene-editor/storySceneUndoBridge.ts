import type { StoryId, StorySceneId } from "@shared/types/story";

/**
 * How something outside a scene editor tab pushes ONE undo step onto that tab's history.
 *
 * The story editor's undo stack is a pair of refs inside {@link useStorySceneEditorController} - per
 * tab, in memory, and unreachable from a sidebar panel or a palette command. That is fine for every
 * edit the editor itself makes and wrong for a whole-scene rewrite arriving from elsewhere: a script
 * import replaces the scene wholesale, and without a checkpoint in front of it the author's next
 * Ctrl+Z would undo *their last typed edit* while leaving the import in place - the two swapped.
 *
 * So the tab publishes its `recordHistory` here for as long as it is mounted, and a caller about to
 * write a scene asks for a checkpoint first. What this buys is exactly and only what is achievable:
 *
 *  - scene has an open editor tab → the import is one Ctrl+Z in that tab;
 *  - scene has no tab → there is no stack to push onto, and none is invented. The caller is expected
 *    to say so before it writes ({@link hasStorySceneUndoRecorder}), not to discover it afterwards.
 *
 * Keyed by tab rather than by scene because "one tab per scene" is a property of
 * `storySceneEditorTabId`, not of this module; iterating is cheap and a second tab on the same scene
 * would otherwise silently lose its checkpoint.
 */
type StorySceneUndoRecorder = {
    storyId: StoryId;
    sceneId: StorySceneId;
    /** The controller's `recordHistory`: captures the scene as it stands, for the undo stack. */
    record: () => boolean;
};

const recorders = new Map<string, StorySceneUndoRecorder>();

/** Publish a tab's undo recorder. Returns the disposer the tab calls when it unmounts. */
export function registerStorySceneUndoRecorder(tabId: string, recorder: StorySceneUndoRecorder): () => void {
    recorders.set(tabId, recorder);
    return () => {
        if (recorders.get(tabId) === recorder) {
            recorders.delete(tabId);
        }
    };
}

export function hasStorySceneUndoRecorder(storyId: StoryId, sceneId: StorySceneId): boolean {
    for (const recorder of recorders.values()) {
        if (recorder.storyId === storyId && recorder.sceneId === sceneId) {
            return true;
        }
    }
    return false;
}

/**
 * Checkpoint every open editor of the named scenes, immediately before they are rewritten.
 *
 * One call for the whole batch, so a multi-scene import is one Ctrl+Z per affected tab rather than
 * one per scene.
 */
export function recordStorySceneUndoCheckpoints(storyId: StoryId, sceneIds: readonly StorySceneId[]): void {
    const targets = new Set(sceneIds);
    for (const recorder of recorders.values()) {
        if (recorder.storyId === storyId && targets.has(recorder.sceneId)) {
            recorder.record();
        }
    }
}
