import { useEffect, useMemo } from "react";
import { useKeybindings, whenEditorFocused } from "@/apps/workspace/hooks";
import { useWorkspace } from "../../context";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { projectHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea, type FocusContext } from "@/lib/workspace/services/ui/types";
import { useHistoryStepHandlers } from "./WorkspaceUndoKeybindings";

/**
 * Undo and redo inside an editor whose recorded changes live on the project's stack.
 *
 * The character editor has no stack of its own - its setters record nothing - but the changes to a
 * character that ARE recorded (a PSD import, an agent's layout, a rename) go on the project's stack.
 * Without this, Ctrl+Z pressed in the editor right after a PSD import did nothing at all: the shell's
 * binding stands down in every editor, and this one had no binding of its own to take its place.
 *
 * The same chord and catalog entry as the shell's (`workspace.undo`), because it does the same thing:
 * the project's last step. While its tab has focus it also names the project's stack as the active
 * one, so the Edit menu offers the step the key would take rather than whichever editor's stack was
 * active last.
 */
export function EditorProjectUndoKeybindings(props: { tabId: string }) {
    const { tabId } = props;
    const { context } = useWorkspace();
    const history = useMemo(
        () => (context ? context.services.get<HistoryService>(Services.History) : null),
        [context],
    );
    const step = useHistoryStepHandlers(projectHistoryScope());

    useEffect(() => {
        if (!context || !history) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        const claim = (focus: FocusContext) => {
            if (focus.area === FocusArea.Editor && focus.targetId === tabId) {
                history.setActiveScope(projectHistoryScope());
            }
        };
        claim(uiService.focus.getFocus());
        const unsubscribe = uiService.focus.onFocusChange(claim);
        return () => {
            unsubscribe();
            if (history.getActiveScopeId() === projectHistoryScope()) {
                history.setActiveScope(null);
            }
        };
    }, [context, history, tabId]);

    const keybindings = useMemo(
        () => [
            {
                id: "undo",
                key: "mod+z",
                description: "Undo the last project-level change",
                handler: step.undo,
            },
            {
                id: "redo",
                key: "mod+shift+z",
                description: "Redo the last project-level change",
                handler: step.redo,
            },
        ],
        [step],
    );

    useKeybindings({
        keybindings,
        when: whenEditorFocused(tabId),
        idPrefix: `editor-project-history-${tabId}`,
        catalogPrefix: "workspace.",
    });

    return null;
}
