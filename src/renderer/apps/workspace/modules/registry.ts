/**
 * Module registry
 * Central location for all built-in modules
 * Third-party plugins can register their modules using the same pattern
 */

import { assetsModule, assetsBottomModule } from "./assets";
import { propertiesModule } from "./properties";
import { consoleModule } from "./console";
import { welcomeModule } from "./welcome";
import { globalActions, globalActionGroups } from "./actions";
import { imagePreviewModule } from "./assets/editors/imagePreviewModule";
import { audioPreviewModule } from "./assets/editors/audioPreviewModule";
import { charactersModule } from "./characters";
import { PanelModule, EditorModule, ModuleAction, ModuleActionGroup } from "./types";
import { uiEditorSurfacesModule } from "./ui-editor";
import { projectPanelModule } from "./project";
import { storyPanelModule } from "./story";
import { storyMotionPanelModule } from "./story-motion";
import { localizationPanelModule } from "./localization";

/**
 * Built-in panel modules
 * All panels that should be registered on workspace startup
 */
export const builtInPanels: PanelModule[] = [
    projectPanelModule,
    storyPanelModule,
    uiEditorSurfacesModule,
    charactersModule,
    assetsModule,
    localizationPanelModule,
    storyMotionPanelModule,
    assetsBottomModule,
    propertiesModule,
    consoleModule,
];

/**
 * Built-in editor modules
 * All editors that should be registered on workspace startup
 */
export const builtInEditors: EditorModule[] = [
    welcomeModule,
    imagePreviewModule,
    audioPreviewModule,
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
export { globalActions, globalActionGroups } from "./actions";
export { uiEditorSurfacesModule } from "./ui-editor";
export { projectPanelModule } from "./project";
export { storyPanelModule } from "./story";
export { storyMotionPanelModule } from "./story-motion";
export { localizationPanelModule } from "./localization";
