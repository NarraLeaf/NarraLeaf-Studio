import type { UIDocument, UIElement, UIElementId } from "@shared/types/ui-editor/document";

const ROOT_WIDGET_TYPE = "nl.root";
const MAX_PARENT_CHAIN_DEPTH = 10_000;

/**
 * Top-left of the element's layout box in surface (root) space, matching EditorNodeWrapper
 * (`left = x + min(0, width)` per ancestor).
 */
export function getElementSurfaceTopLeftEx(
    resolve: (id: UIElementId) => UIElement | undefined,
    elementId: string,
): { x: number; y: number } {
    const chain: UIElementId[] = [];
    const visited = new Set<UIElementId>();
    let cur: string | null | undefined = elementId;
    while (cur && !visited.has(cur) && chain.length < MAX_PARENT_CHAIN_DEPTH) {
        visited.add(cur);
        chain.unshift(cur);
        const el = resolve(cur);
        cur = el?.parentId ?? null;
    }
    let x = 0;
    let y = 0;
    for (const id of chain) {
        const el = resolve(id);
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

export function getElementSurfaceTopLeft(document: UIDocument, elementId: string): { x: number; y: number } {
    return getElementSurfaceTopLeftEx(id => document.elements[id], elementId);
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
