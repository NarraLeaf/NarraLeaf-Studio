import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UISurfaceDiagnostic } from "../types";

const MIN_HIT_AREA = 20 * 20;

function hasInteractiveBinding(el: UIElement): boolean {
    const events = el.behavior?.events;
    if (!events) {
        return false;
    }
    for (const b of Object.values(events)) {
        if (b.kind === "blueprintEvent") {
            return true;
        }
        if (b.kind === "actions" && b.actions?.length) {
            return true;
        }
    }
    return false;
}

export function collectInteractionDiagnostics(document: UIDocument, elements: UIElement[]): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];

    for (const el of elements) {
        if (!hasInteractiveBinding(el)) {
            continue;
        }

        const { visible, opacity, width, height } = el.layout;
        const op = opacity ?? 1;

        if (visible === false) {
            out.push({
                id: `ix:hidden-events:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: `Element “${el.name ?? el.id}” is not visible but still has interaction bindings`,
                hint: "Remove events or make the element visible; runtime may never receive input.",
                elementId: el.id,
            });
        }

        if (visible !== false && op <= 0.01) {
            out.push({
                id: `ix:opaque-events:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: `Element “${el.name ?? el.id}” is nearly invisible (opacity) but has interaction bindings`,
                hint: "Users may not see the control; verify in Dev Mode.",
                elementId: el.id,
            });
        }

        if (!isUIElementFlowLayoutChild(document, el) && width * height > 0 && width * height < MIN_HIT_AREA) {
            out.push({
                id: `ix:small-hit:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: `Element “${el.name ?? el.id}” has a small hit area with interactions`,
                hint: "Prefer at least ~24×24 px for touch targets.",
                elementId: el.id,
            });
        }
    }

    return out;
}
