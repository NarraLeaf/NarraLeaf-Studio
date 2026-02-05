import { BuiltinWidgetModules } from "../../widget-modules/builtin";
import type { ElementTypeDefinition } from "../types";

/**
 * Convert widget modules to legacy ElementTypeDefinition format
 * for backward compatibility with existing code that uses ElementTypeRegistry.
 */
export const BuiltinElementTypes: ElementTypeDefinition[] = BuiltinWidgetModules.map(mod => ({
    type: mod.type,
    displayName: mod.displayName,
    createDefaultElement: mod.createDefaultElement,
}));
