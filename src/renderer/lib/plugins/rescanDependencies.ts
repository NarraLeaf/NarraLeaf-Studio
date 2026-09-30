import type { ProjectDependencyResolution } from "@shared/types/pluginDependencies";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { activateWorkspacePlugin } from "./pluginRuntime";

/**
 * The author's Rescan of the project's dependency table: Project ▸ App's button and the build
 * dialog's.
 *
 * Rescan is the one scan that releases a plugin Studio holds back for its version (see
 * `DependencyScanTrigger`). Every plugin it releases is started in this window, the way switching a
 * plugin on in the Plugins panel starts it: otherwise the table reads as satisfied while the plugin
 * the author has just accepted goes on contributing nothing until the project is reopened. A plugin
 * that is switched off, or has no editor entry, is not started - `activateWorkspacePlugin` answers
 * nothing for it.
 *
 * Only reached where the project can be written, since the rescan persists the table first: a
 * recovery window, which must never start a plugin, freezes writes and refuses before this point.
 */
export async function rescanProjectDependencies(context: WorkspaceContext): Promise<ProjectDependencyResolution> {
    const service = context.services.get<ProjectDependencyService>(Services.ProjectDependency);
    const heldBefore = service.getSuppressedPluginIds();
    const resolution = await service.rescanAndPersist("rescan");
    const stillHeld = new Set(resolution.suppressedPluginIds);
    for (const pluginId of heldBefore) {
        if (stillHeld.has(pluginId)) {
            continue;
        }
        try {
            await activateWorkspacePlugin(context, pluginId);
        } catch (error) {
            // The table is written and the hold is released either way; the Plugins panel reports a
            // plugin that did not come up and offers to reload it.
            console.warn(`[dependencies] could not start ${pluginId} after Rescan`, error);
        }
    }
    return resolution;
}
