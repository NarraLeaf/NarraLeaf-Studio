import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";

export const PLUGINS_PANEL_ID = "narraleaf-studio:plugins";

/** Deep-link payload: open the panel already showing one plugin, or on the project's dependencies. */
export type PluginsPanelPayload = {
    pluginId?: string;
    /**
     * Which reading of the plugin set to open on. Omitted means the installed list.
     *
     * `dependencies` is a temporary state of the same panel: what this project declares it needs,
     * with the remedy each row wants. Anything that noticed an unmet dependency asks for it by
     * name rather than describing where to find it.
     */
    view?: "dependencies";
};

/**
 * Open the plugins panel, optionally on one plugin's page. Lets anything that noticed a plugin
 * problem (a load failure, a suppressed dependency) hand the author to the plugin itself rather
 * than describing where to find it.
 *
 * Deliberately in its own module, importing no component: `pluginRuntime` calls it from the load
 * path, and routing that through the module index would make the panel import the runtime that
 * imports the panel.
 */
export function openPluginsPanel(workspace: WorkspaceContext, payload: PluginsPanelPayload = {}): void {
    const uiService = workspace.services.get<UIService>(Services.UI);
    uiService.panels.updatePayload(PLUGINS_PANEL_ID, payload);
    uiService.panels.show(PLUGINS_PANEL_ID);
}
