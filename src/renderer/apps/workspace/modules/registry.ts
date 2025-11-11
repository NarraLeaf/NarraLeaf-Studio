/**
 * Module registry
 * Central location for all built-in modules
 * Third-party plugins can register their modules using the same pattern
 */

import { assetsModule } from "./assets";
import { propertiesModule } from "./properties";
import { consoleModule } from "./console";
import { welcomeModule } from "./welcome";
import { globalActions, globalActionGroups } from "./actions";
import { imagePreviewModule } from "./assets/editors/imagePreviewModule";
import { PanelModule, EditorModule, ModuleAction, ModuleActionGroup } from "./types";

/**
 * Built-in panel modules
 * All panels that should be registered on workspace startup
 */
export const builtInPanels: PanelModule[] = [
    assetsModule,
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
export { assetsModule } from "./assets";
export { propertiesModule } from "./properties";
export { consoleModule } from "./console";
export { welcomeModule } from "./welcome";
export { globalActions, globalActionGroups } from "./actions";

