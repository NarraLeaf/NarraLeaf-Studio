import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";

export const DICTIONARY_PANEL_ID = "narraleaf-studio:dictionary";

/** Deep-link payload: open the panel with one term already unfolded. */
export type DictionaryPanelPayload = {
    term?: string;
    /**
     * Distinguishes asking for the same term twice.
     *
     * The payload is compared to decide whether anything happened, so a second right click on the
     * same word would otherwise reach a panel that is already showing it and do nothing visible.
     */
    revealToken?: number;
};

/**
 * Open the dictionary panel, optionally on one term.
 *
 * In its own module, importing no component, so a story row can hand the author to the entry behind
 * a mark without the panel and the row importing each other.
 */
export function openDictionaryPanel(workspace: WorkspaceContext, payload: DictionaryPanelPayload = {}): void {
    const uiService = workspace.services.get<UIService>(Services.UI);
    uiService.panels.updatePayload(DICTIONARY_PANEL_ID, {
        ...payload,
        revealToken: payload.revealToken ?? Date.now(),
    });
    uiService.panels.show(DICTIONARY_PANEL_ID);
}
