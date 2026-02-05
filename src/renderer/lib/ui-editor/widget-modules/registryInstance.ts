import { WidgetModuleRegistry } from "./WidgetModuleRegistry";
import { BuiltinWidgetModules } from "./builtin";

/**
 * Shared widget module registry instance.
 * This is the single source of truth for all available widget modules.
 */
export const widgetModuleRegistry = new WidgetModuleRegistry();
widgetModuleRegistry.registerMany(BuiltinWidgetModules);
