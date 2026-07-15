import { useEffect } from "react";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { WorkspaceMenuAction } from "@shared/types/ipcEvents";
import { createProjectFromWizard, openProjectFromFolder } from "./projectActions";

/**
 * Handles the macOS File menu on the home screen.
 *
 * The launcher has no action registry, so unlike the workspace there is nothing to look the menu
 * action up in — the two entries it supports are dispatched directly. Errors surface in the
 * console: the menu has no place to render an inline error the way the Projects tab does.
 *
 * Must be used from a component that stays mounted for the launcher's lifetime; hanging it off
 * the Projects tab would silently stop working whenever the user switched tabs.
 */
export function useLauncherMenuActions(): void {
    useEffect(() => {
        if (!isMacPlatform()) return;

        const token = getInterface().workspace.onMenuAction((action) => {
            void (async () => {
                let error: string | null = null;

                if (action === WorkspaceMenuAction.NewWorkspace) {
                    error = await createProjectFromWizard();
                } else if (action === WorkspaceMenuAction.OpenWorkspace) {
                    error = await openProjectFromFolder();
                } else {
                    return;
                }

                if (error !== null) {
                    console.error(`[MenuAction] ${action} failed: ${error}`);
                }
            })();
        });

        return () => {
            token.cancel();
        };
    }, []);
}
