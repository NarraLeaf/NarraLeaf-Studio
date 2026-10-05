import { createPanelRevealChannel } from "../../search/panelRevealRequest";

export const STORY_PANEL_ID = "narraleaf-studio:story";

/**
 * A request to select one story in the Story panel's list and put its row on screen.
 *
 * What a jump to a story's own entry asks for - the place a story is renamed or deleted, and the one
 * way into a story whose document cannot be opened.
 */
export const storyPanelReveal = createPanelRevealChannel<{ storyId: string }>(STORY_PANEL_ID);
