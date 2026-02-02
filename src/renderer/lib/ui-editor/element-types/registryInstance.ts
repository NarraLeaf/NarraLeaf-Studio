import { ElementTypeRegistry } from "./registry";
import { BuiltinElementTypes } from "./builtin";

/**
 * Shared registry instance for available UI element types.
 */
export const elementTypeRegistry = new ElementTypeRegistry(BuiltinElementTypes);
