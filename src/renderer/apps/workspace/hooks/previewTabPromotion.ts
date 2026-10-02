import type { HistoryScopeId } from "@/lib/workspace/services/history/historyModel";
import { HistoryScopeKind, isHistoryScopeOf } from "@/lib/workspace/services/history/historyScopes";
import { isEditorOwnedFocus } from "@/lib/workspace/services/history/workspaceUndoTarget";
import { FocusArea, type FocusContext } from "@/lib/workspace/services/ui/types";

/**
 * The attribute an editor group puts on the box each tab's editor is drawn in, carrying the tab id.
 *
 * It is how an edit is traced back to the tab it was made in from the DOM event that made it, which
 * is the one witness that does not move: by the time a field commits on blur, focus has already
 * gone wherever the author clicked next.
 */
export const EDITOR_TAB_BODY_ATTRIBUTE = "data-editor-tab-body";

/** The editor tab whose body holds `target`, or null when it is outside every tab. */
export function editorTabOfEventTarget(target: EventTarget | null | undefined): string | null {
    const element = target && typeof (target as Element).closest === "function"
        ? (target as Element)
        : (target as Node | null | undefined)?.parentElement ?? null;
    return element?.closest(`[${EDITOR_TAB_BODY_ATTRIBUTE}]`)?.getAttribute(EDITOR_TAB_BODY_ATTRIBUTE) ?? null;
}

/**
 * Which editor tab an edit was made in, for a preview tab to stop being one.
 *
 * In order:
 *
 *  1. **The tab the triggering event came from.** A field that commits on blur commits after the
 *     author has already clicked somewhere else - the tab strip, a side panel - and focus has gone
 *     with the click; the blur event itself still comes from inside the tab.
 *  2. **The focused editor.**
 *  3. **The editor focus was last on**, while focus is somewhere that edits on that editor's behalf
 *     or nowhere in particular: the property inspector, a dialog the editor opened (variable and
 *     layer dialogs commit after closing, when focus may already have been put back or cleared),
 *     no area at all, or the tab strip. Not for the project's own stack: creating or deleting a
 *     character, an asset or a scene is not an edit inside any editor, and dialogs and menus that do
 *     it would otherwise make whatever editor was last focused permanent.
 *
 * Anywhere else - a side panel, the bottom panel - the edit belongs to no editor tab.
 */
export function resolveEditedTabId(input: {
    scopeId: HistoryScopeId;
    focus: FocusContext;
    eventTabId: string | null;
    lastFocusedEditorTabId: string | null;
}): string | null {
    const { scopeId, focus, eventTabId, lastFocusedEditorTabId } = input;
    if (eventTabId) {
        return eventTabId;
    }
    if (focus.area === FocusArea.Editor && focus.targetId) {
        return focus.targetId;
    }
    if (isEditorOwnedFocus(focus)) {
        return lastFocusedEditorTabId;
    }
    const nowhere = focus.area === FocusArea.None
        || focus.area === FocusArea.Dialog
        || focus.area === FocusArea.EditorTabs;
    if (nowhere && !isHistoryScopeOf(scopeId, HistoryScopeKind.Project)) {
        return lastFocusedEditorTabId;
    }
    return null;
}
