import { useEffect, useRef } from "react";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";

/**
 * Which selection a surface editor tab owns, and when it may take it.
 *
 * The workspace has one selection and one property inspector, shared by every editor tab. A surface
 * editor tab (a page, or a component definition) keeps its canvas mounted while hidden, so it is
 * alive while other tabs are the ones on screen. What it may do with the shared selection follows
 * from that:
 *
 * - **Only a tab that is on screen writes the selection.** It claims it when it is shown - on mount,
 *   or when the author switches back to it - so the inspector describes the canvas the author is
 *   looking at rather than the tab they came from.
 * - **Every tab remembers the last selection that was its own**, hidden or not, and a claim hands
 *   that back. Switching page -> component -> page returns to the element that was selected on the
 *   page instead of dropping it for the page itself.
 * - **A hidden tab never writes.** A hidden tab still re-renders on every selection change, so a
 *   claim that runs on anything but being shown runs after every click in the tab that is: a
 *   component editor left open behind a page would take the selection back from each click on the
 *   page, and two of them would take it from each other until React stopped the loop by crashing
 *   the editors.
 */

/** The parts of the editor state service this needs; the real service satisfies it. */
export interface SurfaceTabSelectionHost {
    getSelection(): SelectionState;
    setSelection(selection: SelectionState): void;
    on(event: "selectionChanged", handler: (selection: SelectionState) => void): () => void;
}

/** Whether `selection` is something on `surfaceId` - the surface itself or elements on it. */
export function selectionBelongsToSurface(selection: SelectionState, surfaceId: string): boolean {
    if (selection.type === "scene") {
        return selection.data === surfaceId;
    }
    if (selection.type === "element") {
        return selection.data.surfaceId === surfaceId && selection.data.elementIds.length > 0;
    }
    return false;
}

/**
 * What a surface tab that has just been shown should make the selection, or `null` to leave it.
 *
 * Only an interface selection is taken over - nothing, a page, or elements on some other surface.
 * A character, an asset or a story row the author picked elsewhere stays theirs: switching to a page
 * is not a reason to lose it.
 *
 * `owned` is the last selection that belonged to this surface. It is handed back with the elements
 * that no longer exist dropped (they may have been deleted, or undone, while the tab was hidden),
 * and falls back to the surface itself when none are left.
 */
export function resolveSurfaceTabSelectionClaim(input: {
    current: SelectionState;
    surfaceId: string;
    owned: SelectionState | null;
    hasElement: (elementId: string) => boolean;
}): SelectionState | null {
    const { current, surfaceId, owned, hasElement } = input;
    if (selectionBelongsToSurface(current, surfaceId)) {
        return null;
    }
    if (current.type !== null && current.type !== "scene" && current.type !== "element") {
        return null;
    }
    if (owned?.type === "element" && owned.data.surfaceId === surfaceId) {
        const elementIds = owned.data.elementIds.filter(hasElement);
        if (elementIds.length > 0) {
            const primaryId =
                owned.data.primaryId && elementIds.includes(owned.data.primaryId)
                    ? owned.data.primaryId
                    : elementIds[elementIds.length - 1];
            return { type: "element", data: { ...owned.data, elementIds, primaryId } };
        }
    }
    return { type: "scene", data: surfaceId };
}

/**
 * Remembers the selection that belongs to this tab's surface, and claims it while the tab is shown.
 *
 * `surfaceId` is the surface the tab shows, or `undefined` while it does not exist (yet), in which
 * case the tab claims nothing. Keyed on the id and on `active`, never on the surface object: a
 * component editor's document is rebuilt from the component, so its surface object is a new one
 * whenever the document is read again.
 */
export function useSurfaceTabSelection({
    stateService,
    documentService,
    surfaceId,
    active,
}: {
    stateService: SurfaceTabSelectionHost | null | undefined;
    documentService: { getDocument(): UIDocument } | null | undefined;
    surfaceId: string | undefined;
    active: boolean;
}): void {
    const ownedRef = useRef<SelectionState | null>(null);

    useEffect(() => {
        ownedRef.current = null;
        if (!stateService || !surfaceId) {
            return undefined;
        }
        const remember = (selection: SelectionState) => {
            if (selectionBelongsToSurface(selection, surfaceId)) {
                ownedRef.current = selection;
            }
        };
        remember(stateService.getSelection());
        return stateService.on("selectionChanged", remember);
    }, [stateService, surfaceId]);

    useEffect(() => {
        if (!active || !stateService || !surfaceId) {
            return;
        }
        const elements = documentService?.getDocument().elements;
        const next = resolveSurfaceTabSelectionClaim({
            current: stateService.getSelection(),
            surfaceId,
            owned: ownedRef.current,
            hasElement: elementId => Boolean(elements?.[elementId]),
        });
        if (next) {
            stateService.setSelection(next);
        }
    }, [active, documentService, stateService, surfaceId]);
}
