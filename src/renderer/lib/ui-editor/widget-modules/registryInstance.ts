import { WidgetModuleRegistry } from "./WidgetModuleRegistry";

/**
 * Shared widget module registry instance.
 * Built-in modules are registered lazily via {@link ensureWidgetModulesRegistered} to avoid a circular
 * import cycle: registry → builtin/index → button|text renderer → UIDocumentService → registry.
 */
export const widgetModuleRegistry = new WidgetModuleRegistry();

let seeded = false;
let seeding: Promise<void> | null = null;

/**
 * Loads built-in widget modules and registers them once. Safe to call multiple times.
 */
export async function ensureWidgetModulesRegistered(): Promise<void> {
    if (seeded) {
        return;
    }
    if (!seeding) {
        seeding = import("./builtin").then(({ BuiltinWidgetModules }) => {
            widgetModuleRegistry.registerMany(BuiltinWidgetModules);
            seeded = true;
        });
    }
    await seeding;
}
