import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { isMacPlatform } from "@/lib/app/platform";
import { useWorkspace } from "../context";
import { useRegistry } from "../registry";
import {
  getActionGroupItems,
  findActionMenuItemById,
  isActionVisible
} from "../components/ui/actionMenuModel";
import { resolveFrozenActionDisabled } from "../components/ui/freezeActionPolicy";
import { useWorkspaceFrozen } from "./useWorkspaceFrozen";
import type { ActionDefinition, ActionGroup } from "../registry/types";
import { UIService } from "@/lib/workspace/services/ui";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import type { FocusContext } from "@/lib/workspace/services/ui";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import type { Workspace } from "@/lib/workspace/workspace";
import { EditMenuRole, MenuActionId } from "@shared/types/menu";

/**
 * Listens for macOS native menu actions and dispatches
 * them to the appropriate handlers in the workspace renderer.
 * Only registers on macOS.
 */
export function useMenuActionHandler(): void {
  const { workspace, context } = useWorkspace();
  const { actions, actionGroups } = useRegistry();
  const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
  const frozen = useWorkspaceFrozen();

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
        // Not everything the menu bar names is a toolbar action. The Develop menu's Dev
        // Mode / Preview / Test are palette COMMANDS - they lost their standalone actions
        // when the Run split-button took over launching them, and for a while afterwards
        // those three menu items dispatched ids nothing answered to, so clicking them did
        // nothing but log this warning. The CommandService is the registry they live in
        // now, so ask it before giving up.
        if (runRegisteredCommand(actionId, context, workspace, focusContext)) {
          return;
        }
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
      // The native menu bar is a second door onto the very same action registry the in-app
      // top bar renders, and it does not pass the bar's disabled state on the way through.
      // Measured on a frozen project: Dev ▸ Build was greyed out in the toolbar and still
      // ran from the macOS menu, so the freeze covered one door and not the other. Ask
      // `freezeActionPolicy` the same question the bar asks - which keeps File and Help
      // (close the window, read the docs) alive, so a frozen workspace is never a trap.
      if (resolveFrozenActionDisabled(action, frozen)) {
        return;
      }
      if (!workspace) {
        console.warn("[MenuAction] Unhandled menu action: workspace is not initialized");
        return;
      }

      action.onClick(workspace);
    },
    [actionGroups, actions, context, focusContext, frozen, workspace]
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

/**
 * True when the standard text-editing behaviour is what the user means right now.
 *
 * Uses the same notion of "typing here" as the KeybindingService, so a keystroke cannot be
 * text editing for one path and a surface action for the other.
 */
function shouldUseNativeEditCommand(role: EditMenuRole): boolean {
  if (isEditableKeyboardTarget(document.activeElement)) {
    return true;
  }
  // Copying a text selection is meaningful outside a text field too - but only a selection the
  // focused surface actually holds. A leftover selection elsewhere in the workspace must not
  // hijack the surface's own copy.
  if (role === "copy" || role === "cut") {
    return hasSelectionInsideActiveElement();
  }
  // paste/delete only make sense as text commands inside an editable.
  return false;
}

function hasSelectionInsideActiveElement(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const active = document.activeElement;
  if (!active) {
    return false;
  }
  return active.contains(selection.getRangeAt(0).commonAncestorContainer);
}

/**
 * Run a directly-registered palette command by id. Returns whether one was found and run, so the
 * caller can still report a genuinely unknown id.
 *
 * `when` is honoured for the same reason the palette honours it: it is where a command states that
 * it cannot run right now (Dev Mode is already up, a test is still going), and the answer must not
 * depend on which door the user came through. The menu bar decides run-vs-stop from the runtime
 * status it renders its checkmarks from, so a refusal here means the two disagreed - worth a line
 * in the console rather than a silent no-op.
 *
 * No freeze check, unlike the action path above: these commands carry the freeze in their own
 * `when` (Preview is off while frozen, a headless test is not), and the blanket
 * `resolveFrozenActionDisabled` rule - everything outside File and Help - would switch off Dev Mode
 * and Test, which a frozen workspace is meant to keep.
 */
function runRegisteredCommand(
  commandId: MenuActionId,
  context: WorkspaceContext | null,
  workspace: Workspace | null,
  focusContext: FocusContext | null
): boolean {
  if (!context || !workspace) {
    return false;
  }
  const command = context.services
    .get<CommandService>(Services.Command)
    .getRegistered()
    .find((candidate) => candidate.id === commandId);
  if (!command) {
    return false;
  }
  if (command.when && !command.when(focusContext ?? { area: FocusArea.None })) {
    console.warn(`[MenuAction] Menu command is not available right now: ${commandId}`);
    return true;
  }
  void command.run(workspace);
  return true;
}

function findRegisteredAction(
  actionId: MenuActionId,
  actions: ActionDefinition[],
  actionGroups: ActionGroup[],
  focusContext: FocusContext | null
): ActionDefinition | null {
  const standalone = actions.find(
    (action) => action.id === actionId && isActionVisible(action, focusContext)
  );
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
