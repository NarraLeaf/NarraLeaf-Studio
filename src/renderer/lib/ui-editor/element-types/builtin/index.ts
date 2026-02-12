import { BuiltinWidgetModules } from "../../widget-modules/builtin";
import type { ElementTypeDefinition } from "../types";

/**
 * Convert widget modules to legacy ElementTypeDefinition format
 * for backward compatibility with existing code that uses ElementTypeRegistry.
 */
const widgetModules = Array.isArray(BuiltinWidgetModules) ? BuiltinWidgetModules : [];

export const BuiltinElementTypes: ElementTypeDefinition[] = widgetModules.map(mod => ({
    type: mod.type,
    displayName: mod.displayName,
    createDefaultElement: mod.createDefaultElement,
}));
