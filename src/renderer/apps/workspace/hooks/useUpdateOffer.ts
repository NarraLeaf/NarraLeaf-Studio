import { useEffect } from "react";
import { translate } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { revealUpdatePanel } from "@/lib/app/updatePresentation";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { NotificationType } from "@/lib/workspace/services/ui/types";
import { UPDATE_PANEL_SETTING_KEY } from "@shared/constants/update";
import { useWorkspace } from "../context";

/**
 * The two moments an update is worth a notification, once each per window and version.
 *
 * - **A version is on offer and nothing is happening about it**: automatic downloads are off, the
 *   author cancelled, or this platform cannot install it (macOS). The action opens the title bar's
 *   update panel, where Download (or the download page) is. When Studio downloads on its own this is
 *   never raised: the state goes straight to downloading, and the title bar shows that.
 * - **An update is ready**: the action restarts Studio to apply it, which is the one thing left to
 *   do. Quitting applies it too, which the panel says.
 *
 * Sticky, because a five-second toast is not an offer. Latched at module level for the same reason
 * `useRecoveryOffer` does it: the notification store is a singleton that outlives any remount, so a
 * ref would stack one identical toast per mount.
 */
const announced = new Set<string>();

export function useUpdateOffer() {
    const { context, recovery } = useWorkspace();

    useEffect(() => {
        // A workspace that is in recovery has a more urgent thing to say, and the shell itself has
        // no notification surface at all.
        if (!context || recovery) {
            return;
        }

        const ui = context.services.get<UIService>(Services.UI);
        let previous: string | null = null;
        const token = getInterface().app.update.onStateChanged(state => {
            const before = previous;
            previous = state.status;
            const version = state.availableVersion;
            if (!version) {
                return;
            }

            if (state.status === "available" || state.status === "manual") {
                const key = `offer:${version}`;
                // Back to "available" from a download or a prepare is the author's own cancel, made
                // in the panel they are looking at; telling them about it would be an echo.
                if (before === "downloading" || before === "preparing") {
                    announced.add(key);
                }
                if (announced.has(key)) {
                    return;
                }
                announced.add(key);
                ui.notifications.showSticky({
                    type: NotificationType.Info,
                    message: translate("update.notification.message", { version }),
                    detail: translate("update.notification.detail", { current: state.currentVersion }),
                    coalesceKey: "app-update",
                    actions: [
                        {
                            label: translate("update.notification.action"),
                            primary: true,
                            onClick: () => {
                                if (!revealUpdatePanel()) {
                                    void getInterface().app.launchSettings({ highlight: UPDATE_PANEL_SETTING_KEY });
                                }
                            },
                        },
                    ],
                });
                return;
            }

            if (state.status === "ready") {
                const key = `ready:${version}`;
                if (announced.has(key)) {
                    return;
                }
                announced.add(key);
                ui.notifications.showSticky({
                    type: NotificationType.Info,
                    message: translate("update.notification.readyMessage", { version }),
                    detail: translate("update.notification.readyDetail"),
                    coalesceKey: "app-update",
                    actions: [
                        {
                            label: translate(state.fastRestart ? "update.actions.restart" : "update.actions.install"),
                            primary: true,
                            onClick: () => {
                                void getInterface().app.update.install();
                            },
                        },
                    ],
                });
            }
        });

        return () => {
            token?.cancel();
        };
    }, [context, recovery]);
}
