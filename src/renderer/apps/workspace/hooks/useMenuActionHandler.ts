import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { useWorkspace } from "../context";
import { useRegistry } from "../registry";
import { getActionGroupItems, findActionMenuItemById, isActionVisible } from "../components/ui/actionMenuModel";
import type { ActionDefinition, ActionGroup } from "../registry/types";
import { UIService } from "@/lib/workspace/services/ui";
import { Services } from "@/lib/workspace/services/services";
import type { FocusContext } from "@/lib/workspace/services/ui";
import { WorkspaceMenuAction } from "@shared/types/ipcEvents";

/**
 * Listens for macOS native menu actions and dispatches
 * them to the appropriate handlers in the workspace renderer.
 * Only registers on macOS.
 */
export function useMenuActionHandler(): void {
    const { workspace, context } = useWorkspace();
    const { actions, actionGroups } = useRegistry();
    const [focusContext, setFocusContext] = useState<FocusContext | null>(null);

    useEffect(() => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        setFocusContext(uiService.focus.getFocus());

        return uiService.focus.onFocusChange((newContext) => {
            setFocusContext(newContext);
        });
    }, [context]);

    const dispatchMenuAction = useCallback(
        (actionId: WorkspaceMenuAction) => {
            const action = findRegisteredAction(actionId, actions, actionGroups, focusContext);
            if (!action) {
                console.warn(`[MenuAction] Unregistered menu action: ${actionId}`);
                return;
            }
            if (action.disabled) {
                return;
            }
            if (!workspace) {
                console.warn("[MenuAction] Unhandled menu action: workspace is not initialized");
                return;
            }

            action.onClick(workspace);
        },
        [actionGroups, actions, focusContext, workspace],
    );

    useEffect(() => {
        if (!isMacPlatform()) return;

        const token = getInterface().workspace.onMenuAction((action) => {
            dispatchMenuAction(action);
        });

        return () => {
            token.cancel();
        };
    }, [dispatchMenuAction]);
}

function findRegisteredAction(
    actionId: WorkspaceMenuAction,
    actions: ActionDefinition[],
    actionGroups: ActionGroup[],
    focusContext: FocusContext | null,
): ActionDefinition | null {
    const standalone = actions.find((action) => action.id === actionId && isActionVisible(action, focusContext));
    if (standalone) {
        return standalone;
    }

    for (const group of actionGroups) {
        const action = findActionMenuItemById(getActionGroupItems(group), actionId, focusContext);
        if (action) {
            return action;
        }
    }

    return null;
}
