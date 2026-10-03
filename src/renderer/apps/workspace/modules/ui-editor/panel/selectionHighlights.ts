import { getUIComponentLink, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import { parseComponentEditorSurfaceId } from "../editors/componentEditorAdapter";

/**
 * What the two project tables in the UI rail light up for the workspace's current selection.
 *
 * The component library and the input actions are both definitions that something on a canvas
 * refers to, and neither said which of its entries the author was looking at: an instance named
 * "Save slot 1" pointed at a component called "Save slot" in a list two sections down, and nothing
 * on screen joined the two. These are the joins, kept pure so the rules can be stated in a test
 * rather than read off a panel.
 */

/** The empty answer, shared so an unchanged "nothing" never reads as a change. */
const NONE: ReadonlySet<string> = new Set();

/**
 * The surface the selection is about - the interface itself, or the one its selected elements are on.
 *
 * A component editor's pseudo surface (`component-editor:<id>`) is returned as it is; it names no
 * entry of `document.surfaces`, which is how the callers below tell it apart.
 */
export function selectionSurfaceId(selection: SelectionState): string | null {
    if (selection.type === "scene") {
        return selection.data;
    }
    if (selection.type === "element") {
        return selection.data.surfaceId;
    }
    return null;
}

/**
 * Find a selected element wherever it is stored.
 *
 * Elements on a page are in `document.elements`; elements inside a component definition are in that
 * component's own table, which is what a component editor's canvas selects from.
 */
function findSelectedElement(document: UIDocument, surfaceId: string, elementId: string): UIElement | null {
    const componentId = parseComponentEditorSurfaceId(surfaceId);
    if (componentId) {
        const component = (document.components ?? []).find(candidate => candidate.id === componentId);
        return component?.elements[elementId] ?? null;
    }
    return document.elements[elementId] ?? null;
}

/**
 * The components the selected elements are instances of.
 *
 * Only a selection of elements counts: an interface being the subject says nothing about any one
 * component, and an element that is not an instance links to nothing. So selecting a plain text, or
 * clicking away to the page itself, answers with the empty set and the library goes back to plain.
 */
export function linkedComponentIdsForSelection(
    selection: SelectionState,
    document: UIDocument,
): ReadonlySet<string> {
    if (selection.type !== "element") {
        return NONE;
    }
    const ids = new Set<string>();
    for (const elementId of selection.data.elementIds) {
        const link = getUIComponentLink(findSelectedElement(document, selection.data.surfaceId, elementId));
        if (link) {
            ids.add(link.componentId);
        }
    }
    return ids.size > 0 ? ids : NONE;
}

/**
 * The input actions the interface being looked at answers.
 *
 * **An action is answered by an interface, never by an element.** The vocabulary is panel-wide by
 * construction: an interface lists the actions it answers (the inspector's Input section), and its
 * own blueprint is the only owner an `On Action` head may sit on besides the global one. An element
 * that wants a raw gesture has its own mouse heads instead. So "the actions relevant to what is
 * selected" is the answered list of the interface the selection is on - the interface itself, or
 * any element of it - and a component editor, which has no Input section, answers none.
 */
export function answeredActionIdsForSelection(
    selection: SelectionState,
    document: UIDocument,
): ReadonlySet<string> {
    const surfaceId = selectionSurfaceId(selection);
    if (!surfaceId) {
        return NONE;
    }
    const surface = document.surfaces.find(candidate => candidate.id === surfaceId);
    const enablements = surface?.actions ?? [];
    if (enablements.length === 0) {
        return NONE;
    }
    return new Set(enablements.map(enablement => enablement.actionId));
}

/** Whether two answers hold the same ids, so a recomputation that changed nothing can be dropped. */
export function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a === b) {
        return true;
    }
    if (a.size !== b.size) {
        return false;
    }
    for (const id of a) {
        if (!b.has(id)) {
            return false;
        }
    }
    return true;
}

/**
 * Bring a row into view inside the list that scrolls it, and nothing further out.
 *
 * Not `scrollIntoView`: that scrolls every scrollable ancestor it passes, including the rail's own
 * containers that are clipped rather than scrolled, and following a canvas selection must never
 * shift the panel around the list. Rows already in view are left exactly where they are.
 */
export function scrollRowIntoListView(list: HTMLElement, row: HTMLElement): void {
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) {
        list.scrollTop -= listBox.top - rowBox.top;
    } else if (rowBox.bottom > listBox.bottom) {
        // A row taller than the list shows its top rather than its bottom.
        list.scrollTop += Math.min(rowBox.bottom - listBox.bottom, rowBox.top - listBox.top);
    }
}
