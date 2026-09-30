import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { canUngroupContainer, filterToTopLevelMovers } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

const ROOT_WIDGET_TYPE = "nl.root";

/** First id in `elementIds` is the stable "leader" for group operations (per product spec). */
export function getSelectionLeaderId(selection: UIElementSelection): string | undefined {
    return selection.elementIds[0];
}

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
 * True when the first selected element is an `nl.container` and there is at least one other selected id.
 */
export function canAddRestToLeaderContainer(selection: UIElementSelection, document: UIDocument): boolean {
    if (selection.elementIds.length < 2) {
        return false;
    }
    const leader = getSelectionLeaderId(selection);
    if (!leader) {
        return false;
    }
    const el = document.elements[leader];
    return el != null && el.type === "nl.container" && !isComponentEditorRootElement(el);
}

/**
 * Ids to reparent into the leader container: top-level movers among the selection except the leader.
 *
 * A component's frame is never one of them - it is not put inside anything.
 */
export function getMoversToGroupIntoLeaderContainer(document: UIDocument, selection: UIElementSelection): string[] {
    const leader = getSelectionLeaderId(selection);
    if (!leader || !canAddRestToLeaderContainer(selection, document)) {
        return [];
    }
    const tops = filterToEditableTopLevel(document, selection.elementIds);
    return tops.filter(id => id !== leader);
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
