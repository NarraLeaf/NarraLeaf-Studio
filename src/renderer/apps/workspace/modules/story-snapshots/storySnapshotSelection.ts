import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";

/**
 * The snapshot the author last selected in the Scene Snapshot panel, per (story, scene). Persisted
 * through {@link PanelStateService} so the panel's dropdown and the row ▶ launcher (which lives in the
 * scene editor tab, a separate component) agree on which snapshot a launch should use.
 */
const SELECTED_SNAPSHOT_KEY = "story:snapshot:selected";
type SelectedSnapshotStore = Record<string, string>;

const keyOf = (storyId: string, sceneId: string) => `${storyId}::${sceneId}`;

export function getSelectedSnapshotId(panelState: PanelStateService, storyId: string, sceneId: string): string | undefined {
    return panelState.getPanelState<SelectedSnapshotStore>(SELECTED_SNAPSHOT_KEY)?.[keyOf(storyId, sceneId)];
}

export function setSelectedSnapshotId(panelState: PanelStateService, storyId: string, sceneId: string, snapshotId: string): void {
    // setPanelState shallow-merges, so only this (story, scene) entry changes.
    panelState.setPanelState<SelectedSnapshotStore>(SELECTED_SNAPSHOT_KEY, { [keyOf(storyId, sceneId)]: snapshotId });
}
