/**
 * Scene Snapshot panel. Registered dynamically by the story scene editor (not a static module),
 * mirroring the Actions/Variables panels, so it carries the active story/scene as its payload.
 */
export { StorySnapshotPanel } from "./StorySnapshotPanel";
export { STORY_SNAPSHOT_PANEL_ID, type StorySnapshotPanelPayload } from "./storySnapshotPanelId";
export { getSelectedSnapshotId, setSelectedSnapshotId } from "./storySnapshotSelection";
