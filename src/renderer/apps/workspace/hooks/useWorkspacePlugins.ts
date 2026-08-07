import { useEffect } from "react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { translate } from "@/lib/i18n";
import {
    loadWorkspacePlugins,
    unloadWorkspacePlugins,
    type WorkspacePluginLoadResult,
} from "@/lib/plugins/pluginRuntime";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { openPluginsPanel } from "../modules/plugins/openPluginsPanel";

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
        const ui = context.services.get<UIService>(Services.UI);

        const handleResults = async (results: WorkspacePluginLoadResult[]) => {
            for (const result of results) {
                if (result.ok) {
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
                // The toast now leads somewhere: the plugins panel shows the same failure with its
                // reason, and the reload / disable / uninstall that answer it.
                ui.notifications.error(
                    translate("plugins.workspace.error.loadFailed", { name: result.pluginId }),
                    result.error,
                    [{
                        label: translate("plugins.workspace.openPanel"),
                        onClick: () => openPluginsPanel(context, { pluginId: result.pluginId }),
                    }],
                );
            }
        };

        loadWorkspacePlugins(context)
            .then(async results => {
                // Unmounted mid-load: the teardown below has already queued the unload behind this
                // very load, so the plugins that just came up go straight back down and there is
                // nothing left to report to a workspace nobody is showing. Teardown is the
                // session's now rather than a local list of cleanups - the plugins panel starts and
                // stops plugins too, and only one of the two knowing what is running is what made a
                // live toggle impossible before.
                if (disposed) {
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
                ui.notifications.error(translate("plugins.workspace.error.hostFailed"), message);
            });

        return () => {
            disposed = true;
            void unloadWorkspacePlugins(context);
        };
    }, [context, recovery]);
}
