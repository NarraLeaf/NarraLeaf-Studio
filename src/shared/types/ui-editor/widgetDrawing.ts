/**
 * Which drawing of an element a running graph means when it names that element.
 *
 * A graph runs in a drawing: a click on a list row runs with that row's instance key, an element
 * inside a component placement runs with the placement's (`widgetAddress.ts` has why a key is
 * needed at all). The element the graph then reads or writes may be drawn in that same drawing - the
 * row's own name label, a widget inside the same placement - or it may not be: the viewer panel
 * beside the list is drawn once, for the page, whichever row was pressed.
 *
 * Addressing every target with the running graph's key was right for the first kind and wrong for
 * the second. The write to the panel landed on `panel` + `row 3`, a drawing nothing renders, so the
 * press did nothing and said nothing - the same node fired from an ordinary button worked. "Press an
 * item, change something outside the list" is the whole of a gallery, a save screen and a backlog,
 * so the only way round it (broadcast to the panel and have it set itself) was a rule every author
 * would have had to discover.
 *
 * The answer is the one drawing the element actually has, as seen from where the graph is running:
 * walk the key's segments from the innermost outwards and stop at the first drawing whose content
 * includes the element. A row's content is its list's template subtree; a placement's is its
 * component's definition. Everything the key names inside that drawing is kept, everything past it
 * is dropped, and an element no segment draws is addressed bare. So a row's own label stays pinned
 * to the row, a panel outside the list is the panel, the list itself is the list, and in a row of
 * a row the target lands in whichever of the two rows really holds it.
 *
 * A pure function of the document and the key: the document is what says which subtree a list
 * repeats, and the key is what says which repetition. Neither half is enough on its own, which is why
 * the question is answered by whoever holds the document rather than by the node that asked.
 *
 * Comments in English per project convention.
 */

import { getUIComponentLink, type UIDocument, type UIElement } from "./document";
import { readUIComponentInstanceSegment } from "./componentInstanceKey";
import { joinUIInstanceKeySegments, splitUIInstanceKey } from "./instanceKey";
import {
    isListLikeWidgetType,
    isUIListItemInstanceSegment,
    isUIListItemInstanceSegmentOf,
    isUIListItemTemplateChild,
} from "./list";
import { buildUIWidgetAddress } from "./widgetAddress";

/**
 * The address of `elementId` as a graph running in the drawing `instanceKey` names means it.
 *
 * With no key this is the element id, byte for byte, which is what every graph outside a row or a
 * placement has always addressed.
 */
export function resolveUIWidgetAddressFromDrawing(
    document: UIDocument,
    elementId: string,
    instanceKey: string | undefined | null,
): string {
    return buildUIWidgetAddress(elementId, resolveUIElementDrawingKey(document, elementId, instanceKey));
}

/**
 * The instance key of the drawing `elementId` is in, as seen from the drawing `instanceKey` names -
 * or undefined when the element is drawn once, for the page.
 *
 * The same walk as {@link resolveUIWidgetAddressFromDrawing}, stopped one step earlier: that one
 * answers "which widget does this graph mean", this one "which drawing is that widget in". The
 * second question has a use of its own. A widget's blueprint keeps its variables per drawing, and a
 * list's Item Click runs in the pressed row while the list that owns the blueprint is not inside any
 * of its rows - so the list's variables belong to the drawing the list is in, which is this answer
 * for the list's own id, and not to the row the event happened to come from.
 */
export function resolveUIElementDrawingKey(
    document: UIDocument,
    elementId: string,
    instanceKey: string | undefined | null,
): string | undefined {
    const segments = splitUIInstanceKey(instanceKey);
    let rowListIds: readonly string[] | null = null;
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i]!;
        const thisDrawing = () => joinUIInstanceKeySegments(segments.slice(0, i + 1));
        const placementId = readUIComponentInstanceSegment(segment);
        if (placementId !== null) {
            const drawn = placementDrawsElement(document, placementId, elementId);
            if (drawn === false) {
                continue;
            }
            return thisDrawing();
        }
        if (isUIListItemInstanceSegment(segment)) {
            rowListIds ??= collectRowListIds(document, elementId);
            if (rowListIds.some(listId => isUIListItemInstanceSegmentOf(segment, listId))) {
                return thisDrawing();
            }
            continue;
        }
        // A segment this rule cannot read - a widget that draws its children more than once in a way
        // the document does not describe. The element may well be one of those drawings, so it keeps
        // the drawing, which is what every address did before this rule existed.
        return thisDrawing();
    }
    return undefined;
}

/**
 * Whether a placement's drawing holds this element, or null when the placement cannot be read.
 *
 * Null is treated as "it may": a placement the document no longer has is not evidence that the
 * element is outside it, and keeping the drawing is what addressing did before.
 */
function placementDrawsElement(document: UIDocument, placementId: string, elementId: string): boolean | null {
    const placement = findElementTable(document, placementId)?.[placementId];
    const componentId = getUIComponentLink(placement)?.componentId;
    const component = componentId ? document.components?.find(item => item.id === componentId) : undefined;
    if (!component) {
        return null;
    }
    return Object.prototype.hasOwnProperty.call(component.elements, elementId);
}

/**
 * Every list whose rows draw this element, innermost first.
 *
 * Walks up from the element inside the table that holds it - the page's, or one component
 * definition's - so a definition's walk ends at its own root rather than wandering onto a page it
 * knows nothing about. A list counts only when the step up into it came through one of its template
 * children: an authored scrollbar is a child of its list too, and it is drawn once per list.
 */
function collectRowListIds(document: UIDocument, elementId: string): string[] {
    const table = findElementTable(document, elementId);
    const out: string[] = [];
    if (!table) {
        return out;
    }
    const visited = new Set<string>();
    let current: UIElement | undefined = table[elementId];
    while (current?.parentId && !visited.has(current.id)) {
        visited.add(current.id);
        const parent: UIElement | undefined = table[current.parentId];
        if (!parent) {
            break;
        }
        if (isListLikeWidgetType(parent.type) && isUIListItemTemplateChild(current)) {
            out.push(parent.id);
        }
        current = parent;
    }
    return out;
}

/** The element table an id lives in: the page elements, or the definition of the component that holds it. */
function findElementTable(document: UIDocument, elementId: string): Record<string, UIElement> | undefined {
    if (Object.prototype.hasOwnProperty.call(document.elements, elementId)) {
        return document.elements;
    }
    return document.components?.find(component => Object.prototype.hasOwnProperty.call(component.elements, elementId))?.elements;
}
