import type { HelpTopicId } from "@/lib/help";

/**
 * Which help topic answers for which sidebar panel.
 *
 * One map instead of a `data-help-topic` sprinkled through a dozen panel components: the attribute
 * is applied once, by `SidebarPanelStack`, around every panel body it renders. A panel that is not
 * listed simply has no help, and `F1` over it falls through to the browser.
 *
 * Ids are repeated as literals rather than imported, because most panel modules export their id
 * from the same file as their component. `panelHelpTopics.test.ts` checks the topics and the ids
 * that do have a module of their own; the rest are literals, and a rename there costs that panel
 * its `F1` silently.
 */
export const PANEL_HELP_TOPICS: Readonly<Record<string, HelpTopicId>> = {
    "narraleaf-studio:story": "storyScene",
    "narraleaf-studio:story-variables": "storyVariables",
    "narraleaf-studio:story-action-creator": "storyCommands",
    "narraleaf-studio:story-snapshots": "sceneSnapshot",
    "narraleaf-studio:story-motion": "storyMotion",
    "narraleaf-studio:assets": "assets",
    "narraleaf-studio:assets-bottom": "assets",
    "narraleaf-studio:characters": "characters",
    "narraleaf-studio:localization": "localization",
    "narraleaf-studio:voice": "voice",
    "narraleaf-studio:ui-surfaces": "uiSurfaces",
    "narraleaf-studio:search": "search",
    "narraleaf-studio:plugins": "plugins",
    "narraleaf-studio:recovery": "recovery",
};

export function panelHelpTopic(panelId: string): HelpTopicId | undefined {
    return PANEL_HELP_TOPICS[panelId];
}
