import { useEffect, useState } from "react";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";

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
 * Counts settled bursts of edits affecting the preview for as long as `enabled` holds.
 *
 * Both documents are listened to: the interface's elements are the uidoc, and the blueprints that
 * drive them live in the graph document - an edit to either changes what the stage draws. A burst
 * counts only if it moved either document's revision: the graph document announces itself again
 * when it has been saved, and a save changes nothing on the stage. Character changes also rebuild
 * the stage, whose compiler and Game UI both read the project's character profiles.
 */
export function useGameUiEditBursts(context: WorkspaceContext | null, enabled: boolean): number {
    const [bursts, setBursts] = useState(0);
    useEffect(() => {
        if (!context || !enabled) {
            return;
        }
        const uiDocumentService = context.services.get<UIDocumentService>(Services.UIDocument);
        const uiGraphService = context.services.get<UIGraphService>(Services.UIGraph);
        const characterService = context.services.get<CharacterService>(Services.Character);
        const revisions = () => `${uiDocumentService.getRevision()}:${uiGraphService.getRevision()}`;
        let seen = revisions();
        let characterChanged = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const schedule = () => {
            if (timer !== null) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                timer = null;
                const now = revisions();
                if (now !== seen || characterChanged) {
                    seen = now;
                    characterChanged = false;
                    setBursts(count => count + 1);
                }
            }, GAME_UI_REFRESH_DEBOUNCE_MS);
        };
        const offDocument = uiDocumentService.onDocumentChanged(schedule);
        const offGraphs = uiGraphService.onGraphsChanged(schedule);
        const offCharacters = characterService.subscribe(() => {
            characterChanged = true;
            schedule();
        });
        return () => {
            offDocument();
            offGraphs();
            offCharacters();
            if (timer !== null) {
                clearTimeout(timer);
            }
        };
    }, [context, enabled]);
    return bursts;
}
