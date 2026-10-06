import { useEffect, useState } from "react";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";

/**
 * How long the Game UI has to stay still before the preview picks up an edit to it.
 *
 * An edit arrives as a burst - a nudge per arrow key, a write per keystroke in an inspector field -
 * and each burst is one change as far as the preview is concerned. Rebuilding the preview costs a
 * main-thread slice the author would feel mid-burst, so it waits for the burst to end: the same
 * pause the preview already waits for after an edit to the scene itself.
 */
export const GAME_UI_REFRESH_DEBOUNCE_MS = 300;

/**
 * Counts settled bursts of Game UI edits for as long as `enabled` holds.
 *
 * Both documents are listened to: the interface's elements are the uidoc, and the blueprints that
 * drive them live in the graph document - an edit to either changes what the stage draws. A burst
 * counts only if it moved either document's revision: the graph document announces itself again
 * when it has been saved, and a save changes nothing on the stage.
 */
export function useGameUiEditBursts(context: WorkspaceContext | null, enabled: boolean): number {
    const [bursts, setBursts] = useState(0);
    useEffect(() => {
        if (!context || !enabled) {
            return;
        }
        const uiDocumentService = context.services.get<UIDocumentService>(Services.UIDocument);
        const uiGraphService = context.services.get<UIGraphService>(Services.UIGraph);
        const revisions = () => `${uiDocumentService.getRevision()}:${uiGraphService.getRevision()}`;
        let seen = revisions();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const schedule = () => {
            if (timer !== null) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                timer = null;
                const now = revisions();
                if (now !== seen) {
                    seen = now;
                    setBursts(count => count + 1);
                }
            }, GAME_UI_REFRESH_DEBOUNCE_MS);
        };
        const offDocument = uiDocumentService.onDocumentChanged(schedule);
        const offGraphs = uiGraphService.onGraphsChanged(schedule);
        return () => {
            offDocument();
            offGraphs();
            if (timer !== null) {
                clearTimeout(timer);
            }
        };
    }, [context, enabled]);
    return bursts;
}
