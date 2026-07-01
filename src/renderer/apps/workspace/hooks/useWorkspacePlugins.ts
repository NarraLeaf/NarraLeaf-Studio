import { useEffect } from "react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { loadWorkspacePlugins, type WorkspacePluginLoadResult } from "@/lib/plugins/pluginRuntime";

export function useWorkspacePlugins() {
    const { context } = useWorkspace();

    useEffect(() => {
        if (!context) {
            return;
        }

        let disposed = false;
        const cleanups: Array<() => void | Promise<void>> = [];
        const ui = context.services.get<UIService>(Services.UI);

        const handleResults = async (results: WorkspacePluginLoadResult[]) => {
            for (const result of results) {
                if (result.ok) {
                    if (result.cleanup) {
                        cleanups.push(result.cleanup);
                    }
                    continue;
                }
                ui.notifications.error(`Plugin ${result.pluginId} failed to load: ${result.error}`);
            }
        };

        loadWorkspacePlugins(context)
            .then(async results => {
                if (disposed) {
                    await Promise.all(results.map(result => result.ok ? result.cleanup?.() : undefined));
                    return;
                }
                await handleResults(results);
            })
            .catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                ui.notifications.error(`Failed to load workspace plugins: ${message}`);
            });

        return () => {
            disposed = true;
            for (const cleanup of cleanups.splice(0).reverse()) {
                void cleanup();
            }
        };
    }, [context]);
}
