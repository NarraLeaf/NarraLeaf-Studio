import type { UIDocument, UIElementId } from "@shared/types/ui-editor/document";

const ROOT_WIDGET_TYPE = "nl.root";

/**
 * Top-left of the element's layout box in surface (root) space, matching EditorNodeWrapper
 * (`left = x + min(0, width)` per ancestor).
 */
export function getElementSurfaceTopLeft(document: UIDocument, elementId: string): { x: number; y: number } {
    const chain: UIElementId[] = [];
    let cur: string | null | undefined = elementId;
    while (cur) {
        chain.unshift(cur);
        cur = document.elements[cur]?.parentId ?? null;
    }
    let x = 0;
    let y = 0;
    for (const id of chain) {
        const el = document.elements[id];
        if (!el || el.type === ROOT_WIDGET_TYPE) {
            continue;
        }
        const layout = el.layout;
        const ox = Math.min(0, layout.width);
        const oy = Math.min(0, layout.height);
        x += layout.x + ox;
        y += layout.y + oy;
    }
    return { x, y };
}

/** Map a surface-space axis-aligned rect into the parent's local layout coordinates. */
export function surfaceRectToParentLocalLayout(
    document: UIDocument,
    parentId: string,
    rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
    const o = getElementSurfaceTopLeft(document, parentId);
    return {
        x: Math.max(0, rect.x - o.x),
        y: Math.max(0, rect.y - o.y),
        width: rect.width,
        height: rect.height,
    };
}
