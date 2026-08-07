/**
 * Module registry
 * Central location for all built-in modules
 * Third-party plugins can register their modules using the same pattern
 */

import { assetsModule, assetsBottomModule } from "./assets";
import { propertiesModule } from "./properties";
import { consoleModule } from "./console";
import { welcomeModule } from "./welcome";
import { helpModule } from "./help";
import { aboutModule } from "./about";
import { globalActions, globalActionGroups } from "./actions";
import { imagePreviewModule } from "./assets/editors/imagePreviewModule";
import { audioPreviewModule } from "./assets/editors/audioPreviewModule";
import { videoPreviewModule } from "./assets/editors/videoPreviewModule";
import { fontPreviewModule } from "./assets/editors/fontPreviewModule";
import { jsonPreviewModule } from "./assets/editors/jsonPreviewModule";
import { charactersModule } from "./characters";
import { PanelModule, EditorModule, ModuleAction, ModuleActionGroup } from "./types";
import { uiEditorSurfacesModule } from "./ui-editor";
import { projectPanelModule } from "./project";
import { storyPanelModule } from "./story";
import { storyMotionPanelModule } from "./story-motion";
import { localizationPanelModule } from "./localization";
import { voicePanelModule } from "./voice";
import { dashboardPanelModule } from "./dashboard";
import { searchPanelModule } from "./search";
import { notificationsPanelModule } from "./notifications";
import { pluginsPanelModule } from "./plugins";
import { testReportModule } from "./testing";

/**
 * Built-in panel modules
 * All panels that should be registered on workspace startup
 */
export const builtInPanels: PanelModule[] = [
    dashboardPanelModule,
    projectPanelModule,
    storyPanelModule,
    searchPanelModule,
    uiEditorSurfacesModule,
    charactersModule,
    assetsModule,
    localizationPanelModule,
    voicePanelModule,
    storyMotionPanelModule,
    assetsBottomModule,
    propertiesModule,
    notificationsPanelModule,
    pluginsPanelModule,
    consoleModule,
];

/**
 * Built-in editor modules
 * All editors that should be registered on workspace startup
 */
export const builtInEditors: EditorModule[] = [
    welcomeModule,
    helpModule,
    aboutModule,
    imagePreviewModule,
    audioPreviewModule,
    videoPreviewModule,
    fontPreviewModule,
    jsonPreviewModule,
    testReportModule,
];

/**
 * Built-in global actions
 * Actions that are always available in the action bar
 */
export const builtInActions: ModuleAction[] = globalActions;

/**
 * Built-in global action groups
 * Action groups that are always available in the menu bar
 */
export const builtInActionGroups: ModuleActionGroup[] = globalActionGroups;

/**
 * Export individual modules for direct access if needed
 */
export { assetsModule, assetsBottomModule } from "./assets";
export { charactersModule } from "./characters";
export { propertiesModule } from "./properties";
export { consoleModule } from "./console";
export { welcomeModule } from "./welcome";
export { helpModule } from "./help";
export { openHelpTab } from "./help/openHelpTab";
export { globalActions, globalActionGroups } from "./actions";
export { uiEditorSurfacesModule } from "./ui-editor";
export { projectPanelModule } from "./project";
export { storyPanelModule } from "./story";
export { storyMotionPanelModule } from "./story-motion";
export { localizationPanelModule } from "./localization";
export { voicePanelModule } from "./voice";
export { dashboardPanelModule } from "./dashboard";
export { pluginsPanelModule, openPluginsPanel, PLUGINS_PANEL_ID } from "./plugins";
export { testReportModule, openTestDialog, openTestReportTab } from "./testing";
export { builtInStatusBarEntries } from "./status-bar";
