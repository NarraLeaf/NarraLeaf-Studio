import { BuiltinWidgetModules } from "../../widget-modules/builtin";
import type { ElementRendererDefinition } from "../ElementRendererRegistry";

/**
 * Convert widget modules to legacy ElementRendererDefinition format
 * for backward compatibility with existing code that uses ElementRendererRegistry.
 */
export const BuiltinElementRenderers: ElementRendererDefinition[] = BuiltinWidgetModules.map(mod => ({
    type: mod.type,
    render: mod.render,
}));
