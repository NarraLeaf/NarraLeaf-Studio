import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { filterToTopLevelMovers } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
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

export function filterSelectionToTopLevelMovers(document: UIDocument, selection: UIElementSelection): string[] {
    return filterToTopLevelMovers(document, selection.elementIds);
}

/**
 * Sets the surface (scene root) as the properties target.
 *
 * This only updates the selection — it intentionally does NOT open the properties panel.
 * Every caller reaches here on deselect / lose-focus (clicking empty canvas, a marquee that
 * hits nothing, Escape, after delete/cut, restoring a surface tab, etc.); auto-opening the
 * panel on those is surprising. The panel is opened only by explicit user action — see
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
    const currentSceneId =
        current.type === "scene"
            ? typeof current.data === "string"
                ? current.data
                : current.data?.id ?? null
            : null;
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
 */
export function getMoversToGroupIntoLeaderContainer(document: UIDocument, selection: UIElementSelection): string[] {
    const leader = getSelectionLeaderId(selection);
    if (!leader || !canAddRestToLeaderContainer(selection, document)) {
        return [];
    }
    const tops = filterToTopLevelMovers(document, selection.elementIds);
    return tops.filter(id => id !== leader);
}

export function isRootElement(elementType: string): boolean {
    return elementType === ROOT_WIDGET_TYPE;
}
