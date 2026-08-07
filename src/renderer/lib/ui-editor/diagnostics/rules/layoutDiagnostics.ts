import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UISurface } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { translate } from "@/lib/i18n";
import type { UISurfaceDiagnostic } from "../types";

/**
 * There is deliberately no "this element is too small" check here.
 *
 * A one-pixel-thin box is ordinary layout, not a defect: dividers, rules and underlines are all
 * authored that way, and two of the example projects that ship with Studio (`overlay-pause`,
 * `settings-layer`) contain exactly such a `Divider`. Flagging them meant the canvas carried a
 * permanent amber marker over healthy work, which is worse than saying nothing - a warning that
 * is always wrong teaches authors to stop reading warnings.
 */
export function collectLayoutDiagnostics(
    document: UIDocument,
    surface: UISurface,
    elements: UIElement[],
): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    const { width: dw, height: dh } = surface.designSize;

    for (const el of elements) {
        const { width, height, visible, opacity } = el.layout;
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
