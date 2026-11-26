import type { UIDocument } from "@shared/types/ui-editor/document";
import type { CanvasLayerAtPoint } from "@/lib/ui-editor/context-menu/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { SELECTABLE_TARGET } from "./constants";

/** What a layer is called in a list of layers: its name, else what kind of widget it is. */
export function describeLayer(document: UIDocument, elementId: string): string {
    const element = document.elements[elementId];
    if (!element) {
        return elementId;
    }
    return element.name?.trim() || widgetModuleRegistry.get(element.type)?.displayName || element.type.replace(/^nl\./, "");
}

function depthBelowRoot(document: UIDocument, elementId: string): number {
    let depth = 0;
    let cur = document.elements[elementId]?.parentId ?? null;
    for (let guard = 0; cur && guard < 256; guard++) {
        depth += 1;
        cur = document.elements[cur]?.parentId ?? null;
    }
    return depth;
}

/**
 * Every layer of one canvas under a point, front-most first.
 *
 * Read from the drawing, not the document: what is under the pointer is what is drawn there, after
 * clipping, stacking and states. Only nodes inside `canvas` count - the interface panel draws every
 * page again as a thumbnail, and a document-wide query would list those too.
 */
export function collectLayersAtPoint(input: {
    canvas: HTMLElement;
    document: UIDocument;
    point: { x: number; y: number };
    selectedIds: readonly string[];
}): CanvasLayerAtPoint[] {
    const { canvas, document, point, selectedIds } = input;
    const ownerDocument = canvas.ownerDocument;
    if (typeof ownerDocument.elementsFromPoint !== "function") {
        return [];
    }
    const layers: CanvasLayerAtPoint[] = [];
    const seen = new Set<string>();
    for (const hit of ownerDocument.elementsFromPoint(point.x, point.y)) {
        const node = hit.closest(SELECTABLE_TARGET) as HTMLElement | null;
        const elementId = node?.dataset.uiElementId;
        if (!node || !elementId || seen.has(elementId) || !canvas.contains(node) || !document.elements[elementId]) {
            continue;
        }
        seen.add(elementId);
        layers.push({
            elementId,
            label: describeLayer(document, elementId),
            depth: depthBelowRoot(document, elementId),
            selected: selectedIds.includes(elementId),
        });
    }
    return layers;
}
