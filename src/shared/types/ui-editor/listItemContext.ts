/**
 * Which list, if any, is drawing this element once per row.
 *
 * Three surfaces ask the same question and used to answer it three ways: the blueprint palette (may
 * this graph read the item scope), the inspector (offer the fields of the shape this row has), and
 * the diagnostics (a field binding on an element no list draws). One walk, so they cannot disagree
 * about where an item template begins.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement } from "./document";
import { getUIListChildSlot, isListLikeWidgetType } from "./list";

export type UIListItemTemplateContext = {
    /** The list whose rows this element is drawn in. */
    listElementId: string;
    /** The shape that list declares, or null when it declares none. */
    structId: string | null;
};

/**
 * The nearest list this element is an item-template descendant of.
 *
 * A direct child with no slot counts as item template, matching what the renderer draws: the
 * scrollbar parts are the two children that opt out, and everything else is a row. The walk stops at
 * the first list rather than continuing, because a nested list starts its own scope - a row of the
 * inner list is an item of the inner list, whatever the outer one is iterating.
 */
export function findOwningListItemTemplate(
    document: Pick<UIDocument, "elements">,
    element: UIElement | undefined | null,
): UIListItemTemplateContext | null {
    let child = element ?? undefined;
    while (child?.parentId) {
        const parent = document.elements[child.parentId];
        if (!parent) {
            return null;
        }
        if (isListLikeWidgetType(parent.type)) {
            const slot = getUIListChildSlot(child.extra);
            if (slot != null && slot !== "itemTemplate") {
                return null;
            }
            const structId = (parent.props as Record<string, unknown> | undefined)?.itemStructId;
            return {
                listElementId: parent.id,
                structId: typeof structId === "string" && structId.trim() ? structId.trim() : null,
            };
        }
        child = parent;
    }
    return null;
}

export function isListItemContextElement(
    document: Pick<UIDocument, "elements">,
    element: UIElement | undefined | null,
): boolean {
    return findOwningListItemTemplate(document, element) != null;
}
