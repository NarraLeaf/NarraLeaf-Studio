import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIDocument, UIElementId, UISurface } from "@shared/types/ui-editor/document";

export type BlueprintDevToolsScope = {
    document: UIDocument;
    activeSurfaceId: string;
};

type SurfaceElementScope = {
    surfaceIds: Set<string>;
    elementIdsBySurfaceId: Map<string, Set<string>>;
};

export function listBlueprintsForDevTools(
    blueprints: Record<string, Blueprint>,
    scope?: BlueprintDevToolsScope,
): Blueprint[] {
    const surfaceScope = scope ? buildBlueprintDevToolsSurfaceScope(scope.document, scope.activeSurfaceId) : null;
    return Object.values(blueprints)
        .filter(bp => shouldShowBlueprintInDevTools(bp) && (!surfaceScope || isBlueprintInSurfaceScope(bp, surfaceScope)))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function isBlueprintInSurfaceScope(bp: Blueprint, scope: SurfaceElementScope): boolean {
    const owner = bp.owner;
    if (owner.kind === "globalMain") {
        return true;
    }
    if (owner.kind === "surfaceMain") {
        return scope.surfaceIds.has(owner.surfaceId);
    }
    if (owner.kind === "widgetMain") {
        return scope.elementIdsBySurfaceId.get(owner.surfaceId)?.has(owner.elementId) === true;
    }
    return false;
}

export function buildBlueprintDevToolsSurfaceScope(document: UIDocument, activeSurfaceId: string): SurfaceElementScope {
    const activeSurface = document.surfaces.find(surface => surface.id === activeSurfaceId);
    const surfaceIds = new Set<string>();
    const elementIdsBySurfaceId = new Map<string, Set<string>>();

    const includeSurface = (surface: UISurface) => {
        surfaceIds.add(surface.id);
        addSurfaceOwnElements(document, elementIdsBySurfaceId, surface);
    };

    if (activeSurface) {
        includeSurface(activeSurface);
    }

    return { surfaceIds, elementIdsBySurfaceId };
}

function addSurfaceOwnElements(
    document: UIDocument,
    elementIdsBySurfaceId: Map<string, Set<string>>,
    surface: UISurface,
): void {
    addElementSubtree(document, getOrCreateElementIdSet(elementIdsBySurfaceId, surface.id), surface.rootElementId);
}

function getOrCreateElementIdSet(map: Map<string, Set<string>>, surfaceId: string): Set<string> {
    let set = map.get(surfaceId);
    if (!set) {
        set = new Set();
        map.set(surfaceId, set);
    }
    return set;
}

function addElementSubtree(document: UIDocument, out: Set<string>, rootElementId: UIElementId): void {
    const visit = (elementId: UIElementId) => {
        if (out.has(elementId)) {
            return;
        }
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        out.add(elementId);
        for (const childId of element.childrenIds) {
            visit(childId);
        }
    };
    visit(rootElementId);
}

function shouldShowBlueprintInDevTools(bp: Blueprint): boolean {
    if (bp.owner.kind === "sharedAsset" || bp.frontend === "typescript" || bp.program.kind === "scriptModule") {
        return true;
    }

    return (
        hasRecordEntries(bp.members?.variables) ||
        hasRecordEntries(bp.members?.fields) ||
        hasRecordEntries(bp.members?.functions) ||
        hasRecordEntries(bp.bindings) ||
        hasRecordEntries(bp.program.graphs.events) ||
        hasRecordEntries(bp.program.graphs.functions) ||
        hasRecordEntries(bp.program.graphs.macros)
    );
}

function hasRecordEntries(value: Record<string, unknown> | undefined): boolean {
    return Boolean(value && Object.keys(value).length > 0);
}
