import { FocusArea, type FocusContext } from "../ui/types";
import type { HistoryScopeId } from "./historyModel";
import { projectHistoryScope } from "./historyScopes";
import type { HistoryService } from "./HistoryService";

/**
 * Which stack a plain "Undo" acts on, given where the author is.
 *
 * One function because two surfaces ask the question - the shell keybinding and the Edit menu - and
 * an Edit menu that names a different step from the one Ctrl+Z would take is worse than no menu
 * item at all.
 *
 * The rule is the boring one, and the boring one is right: **inside an editor, that editor's stack;
 * anywhere else, the project's.** The tempting alternative - fall back to the active editor scope
 * when the project stack is empty - would mean pressing Ctrl+Z in the assets panel rewrites a scene
 * the author is not looking at. "Nothing to undo here" is the correct answer to that keystroke.
 */
export function resolveWorkspaceUndoScope(history: HistoryService, focus: FocusContext): HistoryScopeId {
    if (focus.area === FocusArea.Editor) {
        return history.getActiveScopeId() ?? projectHistoryScope();
    }
    return projectHistoryScope();
}
