import { useEffect } from "react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { loadWorkspacePlugins, type WorkspacePluginLoadResult } from "@/lib/plugins/pluginRuntime";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";

export function useWorkspacePlugins() {
    const { context, recovery } = useWorkspace();

    useEffect(() => {
        if (!context) {
            return;
        }
        // The reason recovery mode exists to begin with: a plugin runs arbitrary code against every
        // workspace service, so "the workspace is behaving strangely" and "a plugin is misbehaving"
        // are indistinguishable from the inside. A shell that loads none of them is the only way to
        // tell those apart, so this is not a courtesy toggle - it is the experiment.
        if (recovery) {
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
                // Logged as well as toasted: the toast is gone in five seconds, and a plugin that
                // failed to load is a leading candidate for whatever the author noticed afterwards.
                reportWorkspaceAnomaly({
                    source: "plugins",
                    operationKey: "workspace.recovery.operations.pluginLoad",
                    path: result.pluginId,
                    error: result.error,
                    severity: "degraded",
                });
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
                reportWorkspaceAnomaly({
                    source: "plugins",
                    operationKey: "workspace.recovery.operations.pluginHostLoad",
                    error,
                    severity: "degraded",
                });
                ui.notifications.error(`Failed to load workspace plugins: ${message}`);
            });

        return () => {
            disposed = true;
            for (const cleanup of cleanups.splice(0).reverse()) {
                void cleanup();
            }
        };
    }, [context, recovery]);
}
