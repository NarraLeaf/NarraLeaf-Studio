import { useEffect } from "react";
import { translate } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { observeWorkspaceAnomalies, type WorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { useWorkspace } from "../context";

/**
 * Notice that this project is quietly broken, and offer the author a way to look at it.
 *
 * The failures worth offering for are the ones the workspace *survived*. A project that will not
 * open already says so, on a screen with its own way into recovery mode. The dangerous case is the
 * other one: assets that came back empty because their index would not parse, a scene that opens
 * blank, a plugin that threw during load - the workspace looks fine, and the author's next move is
 * to start editing on top of it. So this fires on `degraded`, and only on `degraded`.
 *
 * One offer per session, sticky. Sticky because a five-second toast about data loss is not an offer;
 * once, because the underlying cause is almost always single and stacking one toast per unreadable
 * file would bury the workspace it is warning about.
 */
/**
 * Module-level rather than a ref, because the thing it must be once *per* is the window, not the
 * component. A ref is reset by any remount - React's development double-invoke is one, and the retry
 * button is another - and the notification store it would offer into is a singleton shared across
 * every one of those lives, so a per-component guard produces one identical sticky toast per mount
 * stacked on top of the last. A window is one project (see the multi-project window model), so a
 * module-level latch is exactly the right scope, and a genuinely new window gets a fresh module.
 */
let offered = false;

export function useRecoveryOffer() {
    const { context, recovery } = useWorkspace();

    useEffect(() => {
        // Nothing to offer inside the shell itself, and the error screen has its own button.
        if (!context || recovery) {
            return;
        }

        const ui = context.services.get<UIService>(Services.UI);

        return observeWorkspaceAnomalies((anomalies: readonly WorkspaceAnomaly[]) => {
            if (offered) {
                return;
            }
            const degraded = anomalies.filter(anomaly => anomaly.severity === "degraded");
            if (degraded.length === 0) {
                return;
            }
            offered = true;

            ui.notifications.showSticky({
                type: NotificationType.Error,
                message: translate("workspace.recovery.offer.message"),
                detail: degraded.length === 1
                    ? translate("workspace.recovery.offer.detailOne")
                    : translate("workspace.recovery.offer.detailMany", { count: degraded.length }),
                actions: [
                    {
                        label: translate("workspace.recovery.offer.enter"),
                        primary: true,
                        onClick: () => {
                            // The reason is the first anomaly's own text rather than a summary: it
                            // is what the recovery panel leads with, and the panel's whole contract
                            // is that it repeats what happened rather than paraphrasing it.
                            const reason = `${degraded[0].source}: ${degraded[0].raw}`;
                            void getInterface().workspace.setRecoveryMode(true, reason);
                        },
                    },
                ],
            });
        });
    }, [context, recovery]);
}
