import type { UIDocument } from "@shared/types/ui-editor/document";

/**
 * The design size of every element-mounted surface, keyed by id.
 *
 * A frame's box on stage is the size the author drew the surface at, and the story compiler cannot
 * read the UI document — so the host, which holds both, hands this across. Slot surfaces are absent
 * on purpose: they are full-screen and no story row sizes them.
 */
export function collectStageFrameSizes(document: UIDocument): Record<string, { width: number; height: number }> {
    const sizes: Record<string, { width: number; height: number }> = {};
    for (const surface of document.surfaces) {
        if (surface.kind !== "stageSurface" || surface.mount.kind !== "element") {
            continue;
        }
        sizes[surface.id] = { width: surface.designSize.width, height: surface.designSize.height };
    }
    return sizes;
}
