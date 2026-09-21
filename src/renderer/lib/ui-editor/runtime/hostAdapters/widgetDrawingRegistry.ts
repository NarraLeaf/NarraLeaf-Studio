/**
 * What a running surface is drawing, for the events that do not come from any one drawing.
 *
 * Most events know where they happened: a click lands on one row, one placement. A broadcast, a
 * window focus change, a flush a graph's write set off, the slot bridge refreshing a dialog - these
 * name an element, or no element at all, and an element in a list row is on screen once per row.
 * Run once with no drawing, such an event reached a row's widget as nobody: `Get Item Field` read
 * nothing, and `Set Property (self)` wrote to the template, which no row draws. The event ran, the
 * log was clean, and nothing on screen moved.
 *
 * The document cannot answer this alone. It says which list repeats an element, but a list's rows
 * come from bindings and graphs at run time. So each row a list draws is announced here while it is
 * on screen (the element tree does it for every row a widget draws - see `renderChildren`), and the
 * rest - which component holds an element, what its placement supplies - is read off the document
 * and the drawing's key.
 *
 * Comments in English per project convention.
 */

import { getUIComponentLink, resolveUIComponentParams, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { readUIComponentInstanceElementId } from "@shared/types/ui-editor/componentInstanceKey";
import { joinUIInstanceKeySegments, splitUIInstanceKey } from "@shared/types/ui-editor/instanceKey";
import { isUIListItemInstanceSegment, leaveUIListItemInstanceKey, type UIListItemScope } from "@shared/types/ui-editor/list";
import { buildUIWidgetAddress, readUIWidgetAddress } from "@shared/types/ui-editor/widgetAddress";
import { resolveUIElementRowListId } from "@shared/types/ui-editor/widgetDrawing";
import type { UIHostAdapterDrawings, UIHostAdapterElementEventOptions } from "../types";

type RowEntry = { listElementId: string; listItemScope: UIListItemScope };

function hasOwn(table: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(table, key);
}

export function createWidgetDrawingRegistry(document: UIDocument): UIHostAdapterDrawings {
    /** Rows on screen, by the key of the row's drawing. Keys are unique per row by construction. */
    const rows = new Map<string, RowEntry>();

    const componentHolding = (elementId: string) =>
        document.components?.find(component => hasOwn(component.elements, elementId));

    const findElement = (elementId: string): UIElement | undefined =>
        document.elements[elementId] ?? componentHolding(elementId)?.elements[elementId];

    /** The params of the placement a key's innermost component segment names, as the element tree resolves them. */
    const placementParamsOf = (instanceKey: string): Record<string, string> | undefined => {
        const placementId = readUIComponentInstanceElementId(instanceKey);
        const link = placementId ? getUIComponentLink(findElement(placementId)) : null;
        const component = link ? document.components?.find(item => item.id === link.componentId) : undefined;
        if (!component) {
            return undefined;
        }
        const params = resolveUIComponentParams(component, link);
        return Object.keys(params).length > 0 ? params : undefined;
    };

    /** The scope of the innermost row a key is inside - the row a widget drawn there reads. */
    const rowScopeOf = (instanceKey: string): UIListItemScope | null => {
        const segments = splitUIInstanceKey(instanceKey);
        for (let i = segments.length - 1; i >= 0; i--) {
            if (isUIListItemInstanceSegment(segments[i]!)) {
                const rowKey = joinUIInstanceKeySegments(segments.slice(0, i + 1));
                return (rowKey ? rows.get(rowKey)?.listItemScope : undefined) ?? null;
            }
        }
        return null;
    };

    const optionsForAddress = (address: string): UIHostAdapterElementEventOptions | undefined => {
        const { elementId, instanceKey } = readUIWidgetAddress(address);
        if (!instanceKey) {
            return undefined;
        }
        return {
            listItemScope: rowScopeOf(instanceKey),
            instanceKey,
            componentId: componentHolding(elementId)?.id,
            componentParams: placementParamsOf(instanceKey),
        };
    };

    return {
        registerListRow: (listElementId, row) => {
            const entry: RowEntry = { listElementId, listItemScope: row.listItemScope };
            rows.set(row.instanceKey, entry);
            return () => {
                // A row re-announced under the same key (its item changed) owns the entry now; the
                // retraction of the one it replaced must not take it away.
                if (rows.get(row.instanceKey) === entry) {
                    rows.delete(row.instanceKey);
                }
            };
        },
        everyDrawingOf: elementId => {
            const listId = resolveUIElementRowListId(document, elementId);
            // Drawn once, for the page. An element inside a component definition lands here too when
            // no list repeats it; nothing that fans out can be written on one (the ambient heads are
            // not offered in a component), so its placements are not enumerated.
            if (!listId) {
                return [{}];
            }
            return [...rows.entries()]
                .filter(([, row]) => row.listElementId === listId)
                // Grouped by the drawing the list is in, then in row order, so a fan-out runs the rows
                // the way the player reads them rather than in the order they happened to mount.
                .sort(([aKey, a], [bKey, b]) => {
                    const aOuter = leaveUIListItemInstanceKey(aKey) ?? "";
                    const bOuter = leaveUIListItemInstanceKey(bKey) ?? "";
                    if (aOuter !== bOuter) {
                        return aOuter < bOuter ? -1 : 1;
                    }
                    return a.listItemScope.index - b.listItemScope.index;
                })
                .map(([rowKey]) => optionsForAddress(buildUIWidgetAddress(elementId, rowKey)) ?? {});
        },
        optionsForAddress,
    };
}
