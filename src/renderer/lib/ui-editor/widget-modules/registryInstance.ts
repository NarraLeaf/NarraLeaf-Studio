import {
    notifyContributedWidgetsChanged,
    registerContributedWidgetSource,
    type ContributedWidgetDeclaration,
} from "@shared/types/ui-editor/contributedWidgets";
import type { UIWidgetModule } from "./types";
import { WidgetModuleRegistry } from "./WidgetModuleRegistry";

/**
 * Shared widget module registry instance.
 * Built-in modules are registered lazily via {@link ensureWidgetModulesRegistered} to avoid a circular
 * import cycle: registry → builtin/index → button|text renderer → UIDocumentService → registry.
 */
export const widgetModuleRegistry = new WidgetModuleRegistry();

function declarationOf(module: UIWidgetModule, ownerPluginId: string): ContributedWidgetDeclaration {
    return {
        type: module.type,
        ownerPluginId,
        logicApi: module.logicApi,
        acceptsChildren: module.acceptsChildren === true,
    };
}

/**
 * The plugin widgets this registry holds, behind the shared capability lookups.
 *
 * A view, not a copy: each question reads the registry as it is. Only types a plugin owns are
 * answered - a built-in module's answers are the shared tables themselves - so what the document
 * rules and the dispatcher learn here is exactly what `pluginWidgetGuard` let through on registration.
 */
registerContributedWidgetSource({
    get: type => {
        const ownerPluginId = widgetModuleRegistry.getOwner(type);
        const module = ownerPluginId ? widgetModuleRegistry.get(type) : undefined;
        return ownerPluginId && module ? declarationOf(module, ownerPluginId) : undefined;
    },
    list: () => widgetModuleRegistry.list().flatMap(module => {
        const ownerPluginId = widgetModuleRegistry.getOwner(module.type);
        return ownerPluginId ? [declarationOf(module, ownerPluginId)] : [];
    }),
});
widgetModuleRegistry.subscribe(notifyContributedWidgetsChanged);

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
        seeding = import("./builtin").then(({ BuiltinWidgetModules, registerBuiltinWidgetBlueprintNodes }) => {
            widgetModuleRegistry.registerMany(BuiltinWidgetModules);
            registerBuiltinWidgetBlueprintNodes();
            seeded = true;
        });
    }
    await seeding;
}
