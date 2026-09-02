import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

/**
 * The entry the snapshot list shows first, which is not a snapshot: with it selected a launch
 * applies no overrides and every variable starts at the value declared for it.
 *
 * It exists as a constant here and nowhere in the story document. A scene's snapshots are authored
 * content, and a real one standing in for "no overrides" would be written into
 * `StoryScene.sceneSnapshots` - which is the edit, the undo entry and the value pinned against later
 * changes that keeping this out of the document avoids. Selecting it is a choice about this
 * workspace, so it is stored the way the rest of the selection is.
 *
 * The literal is not a UUID and is never drawn: the list renders the entry's label.
 */
export const DECLARED_DEFAULTS_ENTRY = "declared-defaults";

/**
 * Which entry of the snapshot list is selected, per (story, scene). Persisted through
 * {@link PanelStateService} so the panel's dropdown and the row ▶ launcher (which lives in the scene
 * editor tab, a separate component) always name the same one - the panel therefore shows what a
 * launch will do, whichever of the two the author looked at last.
 *
 * `panel_state` is classified as Studio state rather than project content (see
 * `shared/vcs/serviceStores.ts`), so it is written to `.nlstudio/services/`, stays out of version
 * control, and takes no part in any undo stack.
 */
const SELECTED_SNAPSHOT_KEY = "story:snapshot:selected";
type SelectedSnapshotStore = Record<string, string>;

const keyOf = (storyId: string, sceneId: string) => `${storyId}::${sceneId}`;

/**
 * A scene nobody has chosen for reads as the declared-defaults entry, which is the same answer a
 * scene with snapshots and a scene without one give. Nothing is auto-selected on the author's
 * behalf: a snapshot applies once it has been picked, and not before.
 */
export function getSelectedSnapshotId(panelState: PanelStateService, storyId: string, sceneId: string): string {
    return panelState.getPanelState<SelectedSnapshotStore>(SELECTED_SNAPSHOT_KEY)?.[keyOf(storyId, sceneId)]
        ?? DECLARED_DEFAULTS_ENTRY;
}

export function setSelectedSnapshotId(panelState: PanelStateService, storyId: string, sceneId: string, snapshotId: string): void {
    // setPanelState shallow-merges, so only this (story, scene) entry changes.
    panelState.setPanelState<SelectedSnapshotStore>(SELECTED_SNAPSHOT_KEY, { [keyOf(storyId, sceneId)]: snapshotId });
}
