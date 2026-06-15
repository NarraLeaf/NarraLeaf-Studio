import type {
    UIDocument,
    UIElementId,
    UISurface,
} from "@shared/types/ui-editor/document";

export function resolveSurfaceRootElementId(document: UIDocument, surfaceId: string): UIElementId | null {
    const surface = document.surfaces.find(next => next.id === surfaceId);
    if (!surface) {
        return null;
    }
    const linkedRoot = resolveLinkedRootElementId(document, surface);
    return linkedRoot ?? surface.rootElementId;
}

function resolveLinkedRootElementId(document: UIDocument, surface: UISurface): UIElementId | null {
    if (surface.kind !== "stageSurface" || surface.link?.kind !== "appSurface") {
        return null;
    }
    const linkedSurface = document.surfaces.find(next => next.id === surface.link?.surfaceId);
    if (!linkedSurface || linkedSurface.kind !== "appSurface") {
        return null;
    }
    return linkedSurface.rootElementId;
}
