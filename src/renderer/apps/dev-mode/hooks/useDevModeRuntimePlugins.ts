import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { loadRuntimePlugins } from "@/lib/ui-editor/runtime/plugins/loadRuntimePlugins";
import type { RuntimePluginHostController } from "@/lib/ui-editor/runtime/plugins/runtimePluginHostController";
import type { RuntimePluginExclusion } from "@shared/types/plugins";

export type DevModeRuntimePluginsState = {
    /** True once every runtime plugin entry finished loading (or failed). */
    ready: boolean;
    /** Plugin ids whose runtime entry failed to load, with messages. */
    errors: Array<{ pluginId: string; error: string }>;
    /**
     * Enabled runtime plugins this project does not run, with the reason.
     *
     * The main process decides this with the function a build decides it with,
     * so what runs here is what a build carries. It is reported rather than
     * merely applied: the nodes of an excluded plugin degrade to the unknown-node
     * stub, and a stub with nothing said about it is an author looking for a bug
     * in their graph.
     */
    excluded: RuntimePluginExclusion[];
};

/**
 * Loads the runtime entries of the plugins this project runs into the Dev Mode
 * window before the game boots. A failing plugin never blocks the game: its
 * nodes simply stay unregistered and the error is logged.
 *
 * loadRuntimePlugins caches per plugin id+version+entry, so StrictMode
 * double-invocation and Dev Mode live reloads never run setup twice.
 */
export function useDevModeRuntimePlugins(
    rendererRegistry: ElementRendererRegistry,
    pluginHost: RuntimePluginHostController,
): DevModeRuntimePluginsState {
    const [state, setState] = useState<DevModeRuntimePluginsState>({ ready: false, errors: [], excluded: [] });

    useEffect(() => {
        let disposed = false;
        void (async () => {
            try {
                const result = await getInterface().plugins.getRuntimePlugins();
                if (!result.success) {
                    throw new Error(result.error ?? "Failed to list runtime plugins");
                }
                const loadResults = await loadRuntimePlugins(result.data.plugins, {
                    elementRenderers: rendererRegistry,
                    host: pluginHost.host,
                    log: (level, message) => {
                        if (level === "error") {
                            console.error(`[DevMode] ${message}`);
                        } else if (level === "warning") {
                            console.warn(`[DevMode] ${message}`);
                        } else {
                            console.info(`[DevMode] ${message}`);
                        }
                    },
                });
                if (!disposed) {
                    setState({
                        ready: true,
                        errors: loadResults.flatMap(item => item.ok ? [] : [{ pluginId: item.pluginId, error: item.error }]),
                        excluded: result.data.excluded,
                    });
                }
            } catch (error) {
                console.error("[DevMode] runtime plugin loading failed:", error);
                if (!disposed) {
                    setState({
                        ready: true,
                        errors: [{
                            pluginId: "*",
                            error: error instanceof Error ? error.message : String(error),
                        }],
                        excluded: [],
                    });
                }
            }
        })();
        return () => {
            disposed = true;
        };
    }, [pluginHost, rendererRegistry]);

    return state;
}
