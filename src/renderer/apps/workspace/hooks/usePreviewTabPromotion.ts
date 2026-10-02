import { useEffect } from "react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { isHistoryEditCause, type HistoryService } from "@/lib/workspace/services/history/HistoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { editorTabOfEventTarget, resolveEditedTabId } from "./previewTabPromotion";

/**
 * Working in a preview tab makes it an ordinary one.
 *
 * A preview tab is opened to be looked at, so the thing that has to end its provisional state is
 * the author *doing* something in it - and the workspace already has one honest signal for that:
 * an entry landing on an undo stack, or being undone or redone. Every editor that can be edited
 * records one, so this single subscription covers the blueprint canvas, a scene, a surface and an
 * audio asset's loop markers without each of them having to remember to say so. A stack that is
 * only cleared, re-limited or evicted is not an edit, and promotes nothing.
 *
 * Which tab it promotes is the tab the edit was made in; see `resolveEditedTabId` for how that is
 * read off the triggering event and the focus. An edit made anywhere else promotes nothing.
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

        return history.on("changed", ({ scopeId, cause }) => {
            if (!isHistoryEditCause(cause)) {
                return;
            }
            const store = uiService.getStore();
            const tabId = resolveEditedTabId({
                scopeId,
                focus: uiService.focus.getFocus(),
                // The event being dispatched right now, if the edit is being made inside one - set
                // through a handler and the microtasks it queues, and gone once a write waits on I/O.
                eventTabId: editorTabOfEventTarget(typeof window === "undefined" ? null : window.event?.target),
                lastFocusedEditorTabId: store.getLastFocusedEditorTab()?.tabId ?? null,
            });
            if (tabId) {
                store.promoteEditorTab(tabId);
            }
        });
    }, [context, isInitialized]);
}
