/**
 * Scene Flow has no rail entry of its own: it is one view of the story that is already selected in
 * the story panel, so it is reached from that panel's outline header (and story context menu) and
 * opens as an editor tab, where the map has the width it needs to be readable.
 */
export { createSceneFlowTab, openSceneFlowTab, openDefaultSceneFlowTab } from "./openSceneFlowTab";
export { getSceneFlowTabId, type SceneFlowTabPayload } from "./sceneFlowTabId";
export { buildSceneFlowGraph, type SceneFlowGraph } from "./sceneFlowModel";
