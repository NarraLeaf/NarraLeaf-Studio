import { Rect2D } from "@/lib/ui-editor/geometry";

/** Match {@link UIEditorInteractionLayer} / wheel zoom: `clientToSurface` uses viewport bounds, not the inner transformed canvas node. */
export function getViewportContainerRect(viewportEl: HTMLElement | null): Rect2D | null {
    if (!viewportEl) {
        return null;
    }
    const rect = viewportEl.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
