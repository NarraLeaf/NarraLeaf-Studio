import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { loadRuntimePlugins } from "@/lib/ui-editor/runtime/plugins/loadRuntimePlugins";

export type DevModeRuntimePluginsState = {
    /** True once every runtime plugin entry finished loading (or failed). */
    ready: boolean;
    /** Plugin ids whose runtime entry failed to load, with messages. */
    errors: Array<{ pluginId: string; error: string }>;
};

/**
 * Loads the runtime entries of enabled plugins into the Dev Mode window
 * before the game boots. A failing plugin never blocks the game: its nodes
 * simply stay unregistered and the error is logged.
 *
 * loadRuntimePlugins caches per plugin id+version+entry, so StrictMode
 * double-invocation and Dev Mode live reloads never run setup twice.
 */
export function useDevModeRuntimePlugins(rendererRegistry: ElementRendererRegistry): DevModeRuntimePluginsState {
    const [state, setState] = useState<DevModeRuntimePluginsState>({ ready: false, errors: [] });

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
                    });
                }
            }
        })();
        return () => {
            disposed = true;
        };
    }, [rendererRegistry]);

    return state;
}
