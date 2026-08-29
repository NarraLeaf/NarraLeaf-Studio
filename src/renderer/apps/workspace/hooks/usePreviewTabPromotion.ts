import { useEffect } from "react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import type { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isEditorOwnedFocus } from "@/lib/workspace/services/history/workspaceUndoTarget";
import { FocusArea } from "@/lib/workspace/services/ui/types";

/**
 * Working in a preview tab makes it an ordinary one.
 *
 * A preview tab is opened to be looked at, so the thing that has to end its provisional state is
 * the author *doing* something in it - and the workspace already has one honest signal for that:
 * an entry landing on an undo stack. Every editor that can be edited records one, so this single
 * subscription covers the blueprint canvas, a scene, a surface and an audio asset's loop markers
 * without each of them having to remember to say so.
 *
 * Which tab it promotes is the tab the edit was made in: the focused editor, or - while focus is in
 * the property inspector, which writes into the editor behind it - the editor focus was last on.
 * An edit made anywhere else promotes nothing.
 *
 * Editors whose writes are not undoable promote their own tab instead; see `CharacterEditor`.
 */
export function usePreviewTabPromotion(): void {
    const { context, isInitialized } = useWorkspace();

    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        const history = context.services.get<HistoryService>(Services.History);
        const uiService = context.services.get<UIService>(Services.UI);

        return history.on("changed", () => {
            const focus = uiService.focus.getFocus();
            if (!isEditorOwnedFocus(focus)) {
                return;
            }
            const store = uiService.getStore();
            const tabId =
                focus.area === FocusArea.Editor && focus.targetId
                    ? focus.targetId
                    : store.getLastFocusedEditorTab()?.tabId;
            if (tabId) {
                store.promoteEditorTab(tabId);
            }
        });
    }, [context, isInitialized]);
}
