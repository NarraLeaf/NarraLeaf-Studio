import { useEffect } from "react";
import { translate } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { UPDATE_PANEL_SETTING_KEY } from "@shared/constants/update";
import { useWorkspace } from "../context";

/**
 * Tell the author a new version exists, once, and hand them to the place that can act on it.
 *
 * The action opens Settings on the update panel. It deliberately does **not** start the download:
 * the offer and the few-hundred-megabyte transfer are two different decisions, and a toast that
 * is about to auto-dismiss is not where the second one belongs. So the flow is announce here,
 * decide there - two presses, each with what it needs in front of it.
 *
 * Sticky, because a five-second toast is not an offer. Once per window, latched at module level
 * for the same reason `useRecoveryOffer` does it: the notification store is a singleton that
 * outlives any remount, so a ref would stack one identical toast per mount.
 */
let offered = false;

export function useUpdateOffer() {
    const { context, recovery } = useWorkspace();

    useEffect(() => {
        // A workspace that is in recovery has a more urgent thing to say, and the shell itself has
        // no notification surface at all.
        if (!context || recovery) {
            return;
        }

        const ui = context.services.get<UIService>(Services.UI);
        const token = getInterface().app.update.onStateChanged(state => {
            if (offered) {
                return;
            }
            // "ready" is not announced here: an installer already on disk got there because the
            // author pressed Download, so they have seen the panel and do not need telling.
            if (state.status !== "available" && state.status !== "manual") {
                return;
            }
            if (!state.availableVersion) {
                return;
            }
            offered = true;

            ui.notifications.showSticky({
                type: NotificationType.Info,
                message: translate("update.notification.message", { version: state.availableVersion }),
                detail: translate("update.notification.detail", { current: state.currentVersion }),
                actions: [
                    {
                        label: translate("update.notification.action"),
                        primary: true,
                        onClick: () => {
                            void getInterface().app.launchSettings({ highlight: UPDATE_PANEL_SETTING_KEY });
                        },
                    },
                ],
            });
        });

        return () => {
            token?.cancel();
        };
    }, [context, recovery]);
}
