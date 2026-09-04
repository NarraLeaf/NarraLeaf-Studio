import { useEffect } from "react";
import { translate, translateN } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { isUnmet } from "@/lib/workspace/project/dependencyRemedy";
import { openPluginsPanel } from "../modules/plugins/openPluginsPanel";
import { useWorkspace } from "../context";

/** At most this many plugins are named; the rest are covered by the count in the message. */
const NAMES_LISTED = 4;

/**
 * Say that this project needs plugins it has not got, and hand the author to the place that
 * installs them.
 *
 * A warning rather than an error, and raised only for a dependency whose plugin contributes
 * *nothing* right now - absent, withheld for its version, or switched off. In that state the
 * author's own blueprint nodes, widgets and story rows are unknown types, and a build made from
 * the project is missing a piece of itself. A plugin that is merely older than the one the project
 * was authored against still loads and still works, so it raises nothing: a warning that appears
 * when there is nothing to do is one the author learns to close without reading.
 *
 * Nothing new runs at project open for this. The resolution is computed once by
 * `ProjectDependencyService` while the workspace starts, from the table already in the manifest;
 * this reads it, and reads it again if anything re-resolves. No scan, no registry fetch - the
 * store index is read only once the author has actually opened the screen.
 *
 * Sticky, and once per window - the same latch, for the same reason, as the recovery and update
 * offers beside it: the notification store outlives any remount, so a per-component guard stacks
 * an identical toast per mount.
 */
let offered = false;

export function useDependencyOffer() {
    const { context, recovery } = useWorkspace();

    useEffect(() => {
        // A recovery window loads no plugins by design and cannot start one, so an offer to install
        // them there leads to a screen that can only record what the next normal open will apply.
        if (!context || recovery) {
            return;
        }

        const ui = context.services.get<UIService>(Services.UI);
        const dependencies = context.services.get<ProjectDependencyService>(Services.ProjectDependency);

        const evaluate = () => {
            if (offered) {
                return;
            }
            const unmet = (dependencies.getResolution()?.entries ?? []).filter(isUnmet);
            if (unmet.length === 0) {
                return;
            }
            offered = true;

            const names = unmet
                .slice(0, NAMES_LISTED)
                .map(entry => entry.dependency.name?.trim() || entry.dependency.id);
            ui.notifications.showSticky({
                type: NotificationType.Warning,
                message: translateN("plugins.dependencies.unavailable", unmet.length, { count: unmet.length }),
                detail: names.join(", "),
                actions: [{
                    label: translate("plugins.dependencies.open"),
                    primary: true,
                    onClick: () => openPluginsPanel(context, { view: "dependencies" }),
                }],
            });
        };

        evaluate();
        return dependencies.onResolutionChanged(evaluate);
    }, [context, recovery]);
}
