import type { UIDocument, UIElement, UILayout } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeftEx } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import type { AxisAlignedRect } from "./types";

const ROOT_WIDGET_TYPE = "nl.root";

function resolveWithLayoutOverride(
    document: UIDocument,
    elementId: string,
    layoutOverride: UILayout,
): (id: string) => UIElement | undefined {
    return (id: string) => {
        const el = document.elements[id];
        if (!el) {
            return undefined;
        }
        if (id === elementId) {
            return { ...el, layout: layoutOverride };
        }
        return el;
    };
}

/**
 * Surface-space top-left of the element's layout box (translation-only chain),
 * matching EditorNodeWrapper / getElementSurfaceTopLeftEx.
 */
export function getSurfaceTopLeftForLayout(
    document: UIDocument,
    elementId: string,
    layout: UILayout,
): { x: number; y: number } {
    return getElementSurfaceTopLeftEx(resolveWithLayoutOverride(document, elementId, layout), elementId);
}

function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number): { x: number; y: number } {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = px - cx;
    const dy = py - cy;
    return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
    };
}

/**
 * Axis-aligned bounding box in surface space for an element at a hypothetical layout.
 * Uses translation-only accumulation along the parent chain (same as getElementSurfaceTopLeftEx)
 * and applies this element's own rotation around the box center.
 */
export function getSurfaceAxisAlignedBoundsForLayout(
    document: UIDocument,
    elementId: string,
    layout: UILayout,
): AxisAlignedRect {
    const tl = getSurfaceTopLeftForLayout(document, elementId, layout);
    const w = Math.abs(layout.width);
    const h = Math.abs(layout.height);
    const rot = layout.rotation ?? 0;
    if (!rot) {
        return { x: tl.x, y: tl.y, width: w, height: h };
    }
    const cx = tl.x + w / 2;
    const cy = tl.y + h / 2;
    const corners = [
        { x: tl.x, y: tl.y },
        { x: tl.x + w, y: tl.y },
        { x: tl.x + w, y: tl.y + h },
        { x: tl.x, y: tl.y + h },
    ].map(p => rotatePoint(p.x, p.y, cx, cy, rot));
    let minX = corners[0].x;
    let minY = corners[0].y;
    let maxX = corners[0].x;
    let maxY = corners[0].y;
    for (const p of corners) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounds from persisted document layout (no override). */
export function getSurfaceAxisAlignedBoundsFromDocument(document: UIDocument, elementId: string): AxisAlignedRect | null {
    const el = document.elements[elementId];
    if (!el || el.type === ROOT_WIDGET_TYPE) {
        return null;
    }
    return getSurfaceAxisAlignedBoundsForLayout(document, elementId, el.layout);
}
