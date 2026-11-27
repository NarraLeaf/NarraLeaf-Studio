import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { canUngroupContainer, collectSubtreeElementIds, filterToTopLevelMovers, planGroupElements } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

const ROOT_WIDGET_TYPE = "nl.root";

export function getSelectionPrimaryId(selection: UIElementSelection): string | undefined {
    return selection.primaryId ?? selection.elementIds[selection.elementIds.length - 1];
}

/**
 * Whether an element stands for the surface itself rather than for something on it: a page's own
 * root, or a component's root in the editor for that component - the frame the canvas is drawn at.
 *
 * Neither is copied, cut, duplicated, deleted, arranged, aligned or moved into anything, and nothing
 * is pasted beside them. The frame, unlike a page's root, is still selected, sized, named and shown
 * or hidden like any container.
 */
export function isSurfaceRootElement(element: UIElement | null | undefined): boolean {
    return element != null && (element.type === ROOT_WIDGET_TYPE || isComponentEditorRootElement(element));
}

/**
 * The top level of what a structural edit acts on, with the surface's own roots left out first.
 *
 * First rather than after: a component's frame is selectable, and selected together with something
 * inside it, it would otherwise swallow that element as its descendant and leave nothing to act on -
 * so Delete with the frame and a button selected would delete nothing. Dropping it first leaves the
 * button, which is the part of the selection the edit can apply to.
 */
export function filterToEditableTopLevel(document: UIDocument, elementIds: readonly string[]): string[] {
    return filterToTopLevelMovers(
        document,
        elementIds.filter(id => {
            const element = document.elements[id];
            return element != null && !isSurfaceRootElement(element);
        }),
    );
}

export function filterSelectionToTopLevelMovers(document: UIDocument, selection: UIElementSelection): string[] {
    return filterToTopLevelMovers(document, selection.elementIds);
}

/**
 * Sets the surface (scene root) as the properties target.
 *
 * This only updates the selection - it intentionally does NOT open the properties panel.
 * Every caller reaches here on deselect / lose-focus (clicking empty canvas, a marquee that
 * hits nothing, Escape, after delete/cut, restoring a surface tab, etc.); auto-opening the
 * panel on those is surprising. The panel is opened only by explicit user action - see
 * `focusSceneProperties` in UISurfacesPanel and `useFocusProperty`.
 *
 * `_uiService` is retained for call-site compatibility with the many deselect paths.
 */
export function selectSurfaceForProperties(
    stateService: UIEditorStateService,
    surfaceId: string,
    _uiService?: UIService | null,
): void {
    const current = stateService.getSelection();
    const currentSceneId = current.type === "scene" ? current.data : null;
    if (currentSceneId === surfaceId) {
        return;
    }
    stateService.setSelection({ type: "scene", data: surfaceId });
}

/**
 * Whether Group has something to wrap: see `planGroupElements` for which selections can be grouped.
 * A component's frame is never wrapped - it is not put inside anything.
 */
export function canGroupSelection(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null | undefined,
): boolean {
    if (!selection || selection.surfaceId !== surfaceId) {
        return false;
    }
    return planGroupElements(document, surfaceId, selection.elementIds) !== null;
}

/**
 * Groups in the selection that can be dissolved.
 *
 * Unlike the movers above this does *not* drop descendants of other selected elements: selecting a
 * group and a group nested inside it and asking to ungroup means both go, and the order they are
 * dissolved in does not matter - lifting the outer one's children only moves the inner one up.
 */
export function getContainersToUngroup(
    document: UIDocument,
    surfaceId: string,
    selection: UIElementSelection | null,
): string[] {
    if (!selection || selection.surfaceId !== surfaceId) {
        return [];
    }
    return selection.elementIds.filter(id => canUngroupContainer(document, surfaceId, id));
}

export function isRootElement(elementType: string): boolean {
    return elementType === ROOT_WIDGET_TYPE;
}

/**
 * What an undo or redo changed on one surface, to select afterwards: the elements whose own fields
 * (place, size, properties, name, parent) differ, and the ones that came back. Undoing a delete used
 * to bring the element back unselected, and an undone move left the author looking for what moved.
 *
 * `null` when nothing that still exists changed (only deletions) or when the change is too broad to
 * be a selection (`limit`); the caller then leaves the selection as it was.
 */
export function elementsChangedByHistoryStep(
    before: UIDocument,
    after: UIDocument,
    surfaceId: string,
    limit = 64,
): string[] | null {
    const rootId = resolveSurfaceRootElementId(after, surfaceId);
    if (!rootId) {
        return null;
    }
    const fingerprint = (element: UIElement) =>
        JSON.stringify([element.layout, element.props ?? null, element.name ?? null, element.parentId, element.type, element.extra ?? null]);
    const changed: string[] = [];
    for (const id of collectSubtreeElementIds(after, rootId)) {
        const next = after.elements[id];
        if (!next || id === rootId || isSurfaceRootElement(next)) {
            continue;
        }
        const previous = before.elements[id];
        if (!previous || fingerprint(previous) !== fingerprint(next)) {
            changed.push(id);
            if (changed.length > limit) {
                return null;
            }
        }
    }
    // A change inside a changed element is that element's: select the outermost only.
    const changedSet = new Set(changed);
    const outermost = changed.filter(id => {
        let cur = after.elements[id]?.parentId ?? null;
        for (let guard = 0; cur && guard < 256; guard++) {
            if (changedSet.has(cur)) {
                return false;
            }
            cur = after.elements[cur]?.parentId ?? null;
        }
        return true;
    });
    return outermost.length > 0 ? outermost : null;
}
