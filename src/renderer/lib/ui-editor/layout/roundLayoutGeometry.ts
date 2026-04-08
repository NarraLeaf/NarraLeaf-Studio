import type { UILayout } from "@shared/types/ui-editor/document";

const DECIMALS = 2;
const FACTOR = 10 ** DECIMALS;

function roundGeometryScalar(n: number): number {
    if (!Number.isFinite(n)) {
        return n;
    }
    return Math.round(n * FACTOR) / FACTOR;
}

/**
 * Rounds persisted geometry fields (x, y, width, height, rotation) to reduce float noise in the document.
 * Does not alter opacity, visible, lockAspectRatio, or other non-geometry layout keys.
 */
export function roundUILayoutGeometryFields(layout: UILayout): UILayout {
    const next: UILayout = {
        ...layout,
        x: roundGeometryScalar(layout.x),
        y: roundGeometryScalar(layout.y),
        width: roundGeometryScalar(layout.width),
        height: roundGeometryScalar(layout.height),
    };
    if (layout.rotation !== undefined) {
        next.rotation = roundGeometryScalar(layout.rotation);
    }
    return next;
}
