import type { UIDocument, UISurfaceDesignSize } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { getSurfaceAxisAlignedBoundsFromDocument } from "./surfaceRect";
import type { SnapGuideLine } from "./types";

const ROOT_WIDGET_TYPE = "nl.root";

/**
 * Build snap guide lines for a surface: design bounds + non-excluded elements' edges and centers.
 */
export function collectSnapGuideLines(
    document: UIDocument,
    surfaceId: string,
    excludedElementIds: ReadonlySet<string>,
    designSize: UISurfaceDesignSize,
): SnapGuideLine[] {
    const lines: SnapGuideLine[] = [];
    const { width: dw, height: dh } = designSize;

    lines.push(
        { axis: "vertical", value: 0, kind: "surface-edge", sourceElementId: null },
        { axis: "vertical", value: dw, kind: "surface-edge", sourceElementId: null },
        { axis: "vertical", value: dw / 2, kind: "surface-center", sourceElementId: null },
        { axis: "horizontal", value: 0, kind: "surface-edge", sourceElementId: null },
        { axis: "horizontal", value: dh, kind: "surface-edge", sourceElementId: null },
        { axis: "horizontal", value: dh / 2, kind: "surface-center", sourceElementId: null },
    );

    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!rootId) {
        return dedupeLines(lines);
    }

    const subtree = collectSubtreeElementIds(document, rootId);
    for (const id of subtree) {
        if (excludedElementIds.has(id)) {
            continue;
        }
        const el = document.elements[id];
        if (!el || el.type === ROOT_WIDGET_TYPE) {
            continue;
        }
        const b = getSurfaceAxisAlignedBoundsFromDocument(document, id);
        if (!b || b.width <= 0 || b.height <= 0) {
            continue;
        }
        const left = b.x;
        const right = b.x + b.width;
        const top = b.y;
        const bottom = b.y + b.height;
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;

        lines.push(
            { axis: "vertical", value: left, kind: "element-edge", sourceElementId: id },
            { axis: "vertical", value: right, kind: "element-edge", sourceElementId: id },
            { axis: "vertical", value: cx, kind: "element-center", sourceElementId: id },
            { axis: "horizontal", value: top, kind: "element-edge", sourceElementId: id },
            { axis: "horizontal", value: bottom, kind: "element-edge", sourceElementId: id },
            { axis: "horizontal", value: cy, kind: "element-center", sourceElementId: id },
        );
    }

    return dedupeLines(lines);
}

function dedupeLines(lines: SnapGuideLine[]): SnapGuideLine[] {
    const seen = new Set<string>();
    const out: SnapGuideLine[] = [];
    for (const ln of lines) {
        const category = ln.kind === "surface-center" || ln.kind === "element-center" ? "center" : "edge";
        const key = `${ln.axis}:${round6(ln.value)}:${category}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(ln);
    }
    return out;
}

function round6(n: number): number {
    return Math.round(n * 1e6) / 1e6;
}
