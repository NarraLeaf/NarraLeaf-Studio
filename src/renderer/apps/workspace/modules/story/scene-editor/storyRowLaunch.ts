import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";
import { DECLARED_DEFAULTS_ENTRY, getSelectedSnapshotId } from "../../story-snapshots/storySnapshotSelection";

/**
 * Which Scene Snapshot a row start carries, or `undefined` for none.
 *
 * `undefined` is an ordinary answer, not a failure: a launch without a snapshot enters on the
 * variable values the project declares, which is what the scene would hold at that row had the
 * author never opened the snapshot panel. The compiler and the running game already agree on that
 * fallback, so nothing has to be invented for it.
 *
 * The selection is the author's, read from the same key the Scene Snapshot panel writes, so the
 * panel always shows what this will do. Two selections mean no snapshot: the declared-defaults entry
 * the list draws first, and a snapshot the scene no longer holds - which happens when the one that
 * was selected is deleted, and which resolves to the entry the author can see rather than to some
 * other snapshot they did not pick.
 */
export function resolveLaunchSnapshotId(
    snapshots: readonly { id: string }[],
    selected: string,
): string | undefined {
    return selected !== DECLARED_DEFAULTS_ENTRY && snapshots.some(snapshot => snapshot.id === selected)
        ? selected
        : undefined;
}

/**
 * A story row's play control: start the game in Dev Mode at that row rather than at the top of the
 * scene.
 *
 * A snapshot is an input to this, not a precondition. The first version required one - a row start
 * with no snapshot opened the panel and warned instead of playing - so the control never did what it
 * showed on the first press, and what an author learned from it was that starting from a row takes
 * two presses. The reason given for requiring one, that a row start needs concrete variable values,
 * does not hold: the stage walk seeds every scene and saved variable from its declared default and
 * reads persistent values from the profile the game is about to run under, so a launch with no
 * snapshot enters on exactly the values the game itself would hold there.
 *
 * Requiring one also cost more than it bought. Minting a snapshot to satisfy the control wrote the
 * story document, so pressing play edited the project and left an entry on the undo stack; and the
 * snapshot then outlived the reason it was made, pinning variable values the author had since
 * changed, silently, on every later press.
 */
export function launchStoryRowInDevMode(params: {
    context: WorkspaceContext;
    storyId: StoryId;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
}): void {
    const { context, storyId, sceneId, blockId } = params;
    const services = context.services;
    const snapshots = services.get<StoryService>(Services.Story).listSceneSnapshots(storyId, sceneId);
    const selected = getSelectedSnapshotId(services.get<PanelStateService>(Services.PanelState), storyId, sceneId);
    void services.get<DevModeService>(Services.DevMode).launch({
        kind: "story",
        storyId,
        sceneId,
        blockId,
        snapshotId: resolveLaunchSnapshotId(snapshots, selected),
    });
}
