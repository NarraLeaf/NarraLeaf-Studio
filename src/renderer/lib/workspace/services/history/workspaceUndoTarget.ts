import { PROPERTIES_PANEL_ID } from "@/apps/workspace/modules/properties/propertiesPanelId";
import { FocusArea, type FocusContext } from "../ui/types";
import type { HistoryScopeId } from "./historyModel";
import { projectHistoryScope } from "./historyScopes";
import type { HistoryService } from "./HistoryService";

/**
 * Whether this focus still belongs to whichever editor is open.
 *
 * The property inspector is not a place with edits of its own: everything in it writes into the
 * document the active editor is showing, which is why its edits land in that editor's undo stack.
 * Treating it as "somewhere else" meant the author changed a page's background colour in the panel,
 * pressed Ctrl+Z with the panel still focused, and the keystroke went to the project stack - which
 * has nothing in it, so nothing happened, in the one spot where the edit had just been made.
 *
 * Note this says *belongs to*, not *is*. The editor's own `mod+z` still requires real editor focus;
 * this only stops the editor's stack from being disowned while the author is working in its
 * inspector.
 */
export function isEditorOwnedFocus(focus: FocusContext, tabId?: string): boolean {
  if (focus.area === FocusArea.Editor) {
    return tabId === undefined || focus.targetId === tabId;
  }
  return focus.area === FocusArea.RightPanel && focus.targetId === PROPERTIES_PANEL_ID;
}

/**
 * Which stack a plain "Undo" acts on, given where the author is.
 *
 * One function because two surfaces ask the question - the shell keybinding and the Edit menu - and
 * an Edit menu that names a different step from the one Ctrl+Z would take is worse than no menu
 * item at all.
 *
 * The rule is the boring one, and the boring one is right: **inside an editor - or in the inspector
 * that edits it - that editor's stack; anywhere else, the project's.** The tempting alternative -
 * fall back to the active editor scope when the project stack is empty - would mean pressing Ctrl+Z
 * in the assets panel rewrites a scene the author is not looking at. "Nothing to undo here" is the
 * correct answer to that keystroke.
 */
export function resolveWorkspaceUndoScope(
  history: HistoryService,
  focus: FocusContext
): HistoryScopeId {
  if (isEditorOwnedFocus(focus)) {
    return history.getActiveScopeId() ?? projectHistoryScope();
  }
  return projectHistoryScope();
}
