import type { UIDocument, UISurfaceDesignSize } from "@shared/types/ui-editor/document";
import { collectSubtreeElementIds } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { getSurfaceAxisAlignedBoundsFromDocument } from "./surfaceRect";
import type { AxisAlignedRect, SmartSnapDetailSettings, SnapGuideLine } from "./types";
import { DEFAULT_SMART_SNAP_DETAIL_SETTINGS } from "./types";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

const ROOT_WIDGET_TYPE = "nl.root";

/**
 * Build snap guide lines for a surface: design bounds + non-excluded elements' edges and centers.
 */
function filterSnapGuideLinesByDetailSettings(
    lines: readonly SnapGuideLine[],
    detail: SmartSnapDetailSettings,
): SnapGuideLine[] {
    return lines.filter(ln => {
        if (ln.kind === "surface-edge" || ln.kind === "surface-center") {
            return detail.snapCanvasLayout;
        }
        if (ln.kind === "element-edge") {
            return detail.snapElementBorder;
        }
        if (ln.kind === "element-center") {
            return detail.snapElementLayout;
        }
        return true;
    });
}

export function collectSnapGuideLines(
    document: UIDocument,
    surfaceId: string,
    excludedElementIds: ReadonlySet<string>,
    designSize: UISurfaceDesignSize,
    detailSettings: SmartSnapDetailSettings = DEFAULT_SMART_SNAP_DETAIL_SETTINGS,
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

    for (const b of collectSnapCandidateRects(document, surfaceId, excludedElementIds)) {
        const left = b.x;
        const right = b.x + b.width;
        const top = b.y;
        const bottom = b.y + b.height;
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;

        lines.push(
            { axis: "vertical", value: left, kind: "element-edge", sourceElementId: b.id },
            { axis: "vertical", value: right, kind: "element-edge", sourceElementId: b.id },
            { axis: "vertical", value: cx, kind: "element-center", sourceElementId: b.id },
            { axis: "horizontal", value: top, kind: "element-edge", sourceElementId: b.id },
            { axis: "horizontal", value: bottom, kind: "element-edge", sourceElementId: b.id },
            { axis: "horizontal", value: cy, kind: "element-center", sourceElementId: b.id },
        );
    }

    return dedupeLines(filterSnapGuideLinesByDetailSettings(lines, detailSettings));
}

/**
 * The boxes a selection can line up with, in surface space: every drawn layer on the surface except
 * the excluded ones (the selection itself, what it carries, layers hidden in the editor).
 */
export function collectSnapCandidateRects(
    document: UIDocument,
    surfaceId: string,
    excludedElementIds: ReadonlySet<string>,
): (AxisAlignedRect & { id: string })[] {
    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    if (!rootId) {
        return [];
    }
    const out: (AxisAlignedRect & { id: string })[] = [];
    for (const id of collectSubtreeElementIds(document, rootId)) {
        if (excludedElementIds.has(id)) {
            continue;
        }
        const el = document.elements[id];
        if (!el || el.type === ROOT_WIDGET_TYPE || isComponentEditorRootElement(el)) {
            continue;
        }
        // Nothing snaps to what is not drawn: a layer hidden in the game, or inside one, is not on
        // the canvas, and a guide flashing to it lines the selection up with empty space.
        if (isHiddenOnChain(document, id)) {
            continue;
        }
        const b = getSurfaceAxisAlignedBoundsFromDocument(document, id);
        if (!b || b.width <= 0 || b.height <= 0) {
            continue;
        }
        out.push({ ...b, id });
    }
    return out;
}

function isHiddenOnChain(document: UIDocument, elementId: string): boolean {
    let cur: string | null = elementId;
    for (let guard = 0; cur && guard < 256; guard++) {
        const element: UIDocument["elements"][string] | undefined = document.elements[cur];
        if (!element) {
            return false;
        }
        if (element.layout.visible === false) {
            return true;
        }
        cur = element.parentId ?? null;
    }
    return false;
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
