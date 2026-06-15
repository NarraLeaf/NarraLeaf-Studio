import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { filterToTopLevelMovers } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";

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
    return el != null && el.type === "nl.container";
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
