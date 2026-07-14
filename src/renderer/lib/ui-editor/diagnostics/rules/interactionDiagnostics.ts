import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { translate } from "@/lib/i18n";
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
                message: translate("blueprint.diagnostics.interaction.hiddenEvents", { name: el.name ?? el.type }),
                hint: translate("blueprint.diagnostics.interaction.hiddenEventsHint"),
                elementId: el.id,
            });
        }

        if (visible !== false && op <= 0.01) {
            out.push({
                id: `ix:opaque-events:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: translate("blueprint.diagnostics.interaction.opaqueEvents", { name: el.name ?? el.type }),
                hint: translate("blueprint.diagnostics.interaction.opaqueEventsHint"),
                elementId: el.id,
            });
        }

        if (!isUIElementFlowLayoutChild(document, el) && width * height > 0 && width * height < MIN_HIT_AREA) {
            out.push({
                id: `ix:small-hit:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: translate("blueprint.diagnostics.interaction.smallHit", { name: el.name ?? el.type }),
                hint: translate("blueprint.diagnostics.interaction.smallHitHint"),
                elementId: el.id,
            });
        }
    }

    return out;
}
