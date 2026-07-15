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
import { EditMenuRole, MenuActionId } from "@shared/types/ipcEvents";

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
        (actionId: MenuActionId) => {
            const action = findRegisteredAction(actionId, actions, actionGroups, focusContext);
            if (!action) {
                console.warn(`[MenuAction] Unregistered menu action: ${actionId}`);
                return;
            }
            // An action standing in for an Edit-menu command also owns that command's Cmd
            // shortcut, so it fires for plain text editing too. Route by what the user is
            // actually doing: caret in a text field (or a live text selection for copy/cut)
            // means text editing, not the surface action.
            if (action.menuRole && shouldUseNativeEditCommand(action.menuRole)) {
                getInterface().window.editCommand(action.menuRole);
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

function isEditableElement(element: Element | null): boolean {
    if (!element) {
        return false;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return !element.readOnly && !element.disabled;
    }
    return element instanceof HTMLElement && element.isContentEditable;
}

/** True when the standard text-editing behaviour is what the user means right now. */
function shouldUseNativeEditCommand(role: EditMenuRole): boolean {
    const editableFocused = isEditableElement(document.activeElement);
    if (role === "copy" || role === "cut") {
        const selection = window.getSelection();
        return editableFocused || (selection !== null && !selection.isCollapsed);
    }
    // paste/delete only make sense as text commands inside an editable.
    return editableFocused;
}

function findRegisteredAction(
    actionId: MenuActionId,
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
