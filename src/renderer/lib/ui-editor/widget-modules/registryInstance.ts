import {
    notifyContributedWidgetsChanged,
    registerContributedWidgetSource,
    type ContributedWidgetDeclaration,
} from "@shared/types/ui-editor/contributedWidgets";
import type { UIWidgetModule } from "./types";
import { WidgetModuleRegistry } from "./WidgetModuleRegistry";

/**
 * Shared widget module registry instance.
 * Workspace startup attaches built-in implementations; declaration queries can use this registry
 * for plugin contributions without loading editor implementations.
 */
export const widgetModuleRegistry = new WidgetModuleRegistry();

function declarationOf(module: UIWidgetModule, ownerPluginId: string): ContributedWidgetDeclaration {
    return {
        type: module.type,
        ownerPluginId,
        logicApi: module.logicApi,
        acceptsChildren: module.acceptsChildren === true,
        ...(module.partSlots && module.partSlots.length > 0 ? { partSlots: module.partSlots } : {}),
        ...(module.textSites && module.textSites.length > 0 ? { textSites: module.textSites } : {}),
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
