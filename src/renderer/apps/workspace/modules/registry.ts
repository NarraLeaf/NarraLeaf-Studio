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
import { settingsModule } from "./settings";
import { PanelModule, EditorModule, ModuleAction, ModuleActionGroup } from "./types";
import { uiEditorSurfacesModule } from "./ui-editor";

/**
 * Built-in panel modules
 * All panels that should be registered on workspace startup
 */
export const builtInPanels: PanelModule[] = [
    uiEditorSurfacesModule,
    charactersModule,
    assetsModule,
    assetsBottomModule,
    settingsModule,
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
export { settingsModule } from "./settings";
export { globalActions, globalActionGroups } from "./actions";
export { uiEditorSurfacesModule } from "./ui-editor";

