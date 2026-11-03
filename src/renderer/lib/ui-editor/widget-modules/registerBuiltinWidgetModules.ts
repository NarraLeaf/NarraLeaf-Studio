import { widgetModuleRegistry } from "./registryInstance";

let seeding: Promise<void> | null = null;

/** Workspace-only composition of declarations, drawing and editing implementations. */
export function ensureWidgetModulesRegistered(): Promise<void> {
    seeding ??= import("./builtin").then(({ BuiltinWidgetModules, registerBuiltinWidgetBlueprintNodes }) => {
        widgetModuleRegistry.registerMany(BuiltinWidgetModules);
        registerBuiltinWidgetBlueprintNodes();
    }).catch(error => {
        seeding = null;
        throw error;
    });
    return seeding;
}
