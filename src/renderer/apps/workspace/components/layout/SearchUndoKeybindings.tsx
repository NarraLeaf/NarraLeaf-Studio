import { useMemo } from "react";
import { useKeybindings } from "@/apps/workspace/hooks";
import { searchReplaceHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { isSearchPanelFocus } from "@/lib/workspace/services/history/workspaceUndoTarget";
import { useHistoryStepHandlers } from "./WorkspaceUndoKeybindings";

/**
 * Undo and redo in the Search panel: the panel's last replace, taken back in every scene it touched.
 *
 * A replace leaves one step in each scene it changed, so Ctrl+Z in a scene takes back exactly the
 * replace there. These keys take back the whole replace at once from the panel it was made in, by
 * taking those scene steps (`HistoryService.pushGroup`) - a scene edited after the replace keeps it,
 * and the author is told which.
 *
 * Their own catalog entries rather than `workspace.undo` with another stack behind it, because the
 * chord does something different here, and the cheat sheet lists it under the panel only when it is
 * an entry of its own. `workspace.undo` stands down on this panel so that only one of them is live.
 *
 * Focus in one of the panel's text boxes never reaches these: the keybinding service leaves keys to
 * a field being typed in, where Ctrl+Z is text undo.
 */
export function SearchUndoKeybindings() {
    const step = useHistoryStepHandlers(searchReplaceHistoryScope());

    const keybindings = useMemo(
        () => [
            {
                id: "undo",
                key: "mod+z",
                description: "Undo the Search panel's last replace",
                when: isSearchPanelFocus,
                handler: step.undo,
            },
            {
                id: "redo",
                key: "mod+shift+z",
                description: "Redo the Search panel's last replace",
                when: isSearchPanelFocus,
                handler: step.redo,
            },
        ],
        [step],
    );

    useKeybindings({ keybindings, idPrefix: "search-history", catalogPrefix: "search." });

    return null;
}
