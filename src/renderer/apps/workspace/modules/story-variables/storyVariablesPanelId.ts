import type { StoryId, StorySceneId } from "@shared/types/story";
import { createPanelRevealChannel } from "../search/panelRevealRequest";

export const STORY_VARIABLES_PANEL_ID = "narraleaf-studio:story-variables";

export type StoryVariablesPanelPayload = {
    tabId?: string;
    storyId: StoryId;
    sceneId: StorySceneId;
    storyName?: string;
    sceneName?: string;
};

/**
 * A request to put one project-level variable's row on screen and mark it.
 *
 * A channel rather than the panel's payload: the payload belongs to the focused scene editor, which
 * publishes its scene there, and a jump that wrote it would take the scene section away.
 */
export const storyVariableReveal = createPanelRevealChannel<{ scope: "saved" | "persistent"; variableId: string }>(
    STORY_VARIABLES_PANEL_ID,
);
