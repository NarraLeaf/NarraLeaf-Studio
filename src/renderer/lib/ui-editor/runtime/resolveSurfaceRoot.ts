import type {
    UIDocument,
    UIElementId,
} from "@shared/types/ui-editor/document";

export function resolveSurfaceRootElementId(document: UIDocument, surfaceId: string): UIElementId | null {
    const surface = document.surfaces.find(next => next.id === surfaceId);
    if (!surface) {
        return null;
    }
    return surface.rootElementId;
}
