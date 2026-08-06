import { useCallback, useMemo } from "react";
import { useKeybindings } from "@/apps/workspace/hooks";
import { useWorkspace } from "../../context";
import { useFreezeGuard } from "../ui/freezeGuard";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { projectHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea, type FocusContext } from "@/lib/workspace/services/ui/types";

/**
 * Undo and redo for everything that is not inside an editor.
 *
 * Editors register their own `mod+z` (per tab, with a `whenEditorFocused` guard), and those keep
 * working exactly as before - this binding **stands down whenever an editor has focus**, which is
 * what the `when` below is for. `KeybindingService` dispatches the first matching binding in
 * registration order and the shell mounts before any tab, so without that guard this one would win
 * every time and take Ctrl+Z away from the story editor.
 *
 * What it adds is the case that had no owner at all: the author deletes a character in the left
 * panel and presses Ctrl+Z. Before, nothing was listening there - and the honest description of
 * "nothing happened" is worse than it sounds, because if focus had still been in a story tab the
 * keypress would have undone *a story edit* instead, which reads as undo doing the wrong thing.
 *
 * Deliberately routed to the project scope rather than to `getActiveScopeId()`. The active scope is
 * an editor's, and reaching into it from outside that editor is the same mistake in the other
 * direction: pressing Ctrl+Z in the assets panel must not rewrite a scene the author cannot see.
 */
export function WorkspaceUndoKeybindings() {
    const { context } = useWorkspace();
    const freeze = useFreezeGuard();
    const history = useMemo(
        () => (context ? context.services.get<HistoryService>(Services.History) : null),
        [context],
    );

    const outsideAnEditor = useCallback(
        (focus: FocusContext) => focus.area !== FocusArea.Editor,
        [],
    );

    const keybindings = useMemo(
        () => [
            {
                id: "undo",
                key: "mod+z",
                description: "Undo the last project-level change",
                when: outsideAnEditor,
                handler: freeze.run(() => {
                    history?.undo(projectHistoryScope());
                }),
            },
            {
                id: "redo",
                key: "mod+shift+z",
                description: "Redo the last project-level change",
                when: outsideAnEditor,
                handler: freeze.run(() => {
                    history?.redo(projectHistoryScope());
                }),
            },
        ],
        [freeze, history, outsideAnEditor],
    );

    useKeybindings({ keybindings, idPrefix: "workspace-history", catalogPrefix: "workspace." });

    return null;
}
