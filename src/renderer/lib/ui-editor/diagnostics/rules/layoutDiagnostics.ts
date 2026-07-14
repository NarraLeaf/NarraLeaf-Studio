import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UISurface } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { translate } from "@/lib/i18n";
import type { UISurfaceDiagnostic } from "../types";

const MIN_VISIBLE_SIZE = 2;

export function collectLayoutDiagnostics(
    document: UIDocument,
    surface: UISurface,
    elements: UIElement[],
): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    const { width: dw, height: dh } = surface.designSize;

    for (const el of elements) {
        const { x, y, width, height, visible, opacity } = el.layout;
        if (isUIElementFlowLayoutChild(document, el)) {
            continue;
        }
        if (visible === false) {
            continue;
        }
        const op = opacity ?? 1;
        if (op <= 0.01) {
            continue;
        }
        if (width < MIN_VISIBLE_SIZE || height < MIN_VISIBLE_SIZE) {
            out.push({
                id: `layout:tiny:${el.id}`,
                severity: "warning",
                source: "layout",
                message: translate("blueprint.diagnostics.layout.tiny", {
                    name: el.name ?? el.type,
                    width: Math.round(width),
                    height: Math.round(height),
                }),
                hint: translate("blueprint.diagnostics.layout.tinyHint"),
                elementId: el.id,
            });
        }
        const origin = getElementSurfaceTopLeft(document, el.id);
        const wAbs = Math.abs(width);
        const hAbs = Math.abs(height);
        const right = origin.x + wAbs;
        const bottom = origin.y + hAbs;
        if (right < 0 || bottom < 0 || origin.x > dw || origin.y > dh) {
            out.push({
                id: `layout:oob:${el.id}`,
                severity: "warning",
                source: "layout",
                message: translate("blueprint.diagnostics.layout.outOfBounds", { name: el.name ?? el.type }),
                hint: translate("blueprint.diagnostics.layout.outOfBoundsHint", { width: dw, height: dh }),
                elementId: el.id,
            });
        }
    }
    return out;
}
