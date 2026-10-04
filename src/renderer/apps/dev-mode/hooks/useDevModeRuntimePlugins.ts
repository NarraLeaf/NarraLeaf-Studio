import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { loadRuntimePlugins } from "@/lib/ui-editor/runtime/plugins/loadRuntimePlugins";
import type { RuntimePluginHostController } from "@/lib/ui-editor/runtime/plugins/runtimePluginHostController";
import type { PluginManifestLocalized, RuntimePluginExclusion } from "@shared/types/plugins";

/**
 * One runtime entry that did not load.
 *
 * `pluginName` is what the report names, and it is null for exactly one failure: the plugin list
 * itself could not be read, so nothing here is about a particular plugin. Every other entry has a
 * name, because a report an author can act on has to say which plugin stopped working.
 */
export type DevModeRuntimePluginFailure = {
    pluginId: string;
    pluginName: string | null;
    /** The manifest's translations of the name, applied where the report is written. */
    localized?: PluginManifestLocalized;
    error: string;
};

export type DevModeRuntimePluginsState = {
    /** True once every runtime plugin entry finished loading (or failed). */
    ready: boolean;
    /** Runtime entries that failed to load, with messages. */
    errors: DevModeRuntimePluginFailure[];
    /**
     * Enabled runtime plugins this project does not run, with the reason.
     *
     * The main process decides this with the function a build decides it with,
     * so what runs here is what a build carries. Every enabled plugin the
     * table does not name is here, used or not; which of them the author is
     * told about is decided against the bundle (`reportableRuntimePluginExclusions`).
     */
    excluded: RuntimePluginExclusion[];
    /**
     * The plugins this project runs here, whether or not their entry loaded.
     *
     * Read alongside `excluded`: deciding whether the project refers to an excluded plugin means
     * reading plugin ids off type names, and an id nested inside a running plugin's (`acme.fx`
     * beside `acme.fx.pro`) has to leave the longer one its own types.
     */
    running: string[];
};

/**
 * Loads the runtime entries of the plugins this project runs into the Dev Mode
 * window before the game boots. A failing plugin never blocks the game: its
 * nodes simply stay unregistered, and what failed is reported rather than only
 * logged - a plugin whose entry threw leaves its nodes drawn as unknown-node
 * stubs, which is indistinguishable from the author having placed the wrong
 * node until something says the plugin did not load.
 *
 * loadRuntimePlugins caches per plugin id+version+entry, so StrictMode
 * double-invocation and Dev Mode live reloads never run setup twice.
 */
export function useDevModeRuntimePlugins(
    rendererRegistry: ElementRendererRegistry,
    pluginHost: RuntimePluginHostController,
): DevModeRuntimePluginsState {
    const [state, setState] = useState<DevModeRuntimePluginsState>({ ready: false, errors: [], excluded: [], running: [] });

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
                    const localizedById = new Map(result.data.plugins.map(plugin => [plugin.plugin.id, plugin.manifest.localized]));
                    setState({
                        ready: true,
                        errors: loadResults.flatMap((item) => {
                            if (item.ok) {
                                return [];
                            }
                            const localized = localizedById.get(item.pluginId);
                            return [{
                                pluginId: item.pluginId,
                                pluginName: item.pluginName,
                                ...(localized ? { localized } : {}),
                                error: item.error,
                            }];
                        }),
                        excluded: result.data.excluded,
                        running: result.data.plugins.map(plugin => plugin.plugin.id),
                    });
                }
            } catch (error) {
                console.error("[DevMode] runtime plugin loading failed:", error);
                if (!disposed) {
                    setState({
                        ready: true,
                        // The list itself, not one plugin: nothing loaded and there is no name to
                        // give. `*` is the id every other reader already treats as "all of them".
                        errors: [{
                            pluginId: "*",
                            pluginName: null,
                            error: error instanceof Error ? error.message : String(error),
                        }],
                        excluded: [],
                        running: [],
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
