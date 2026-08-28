import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { translate } from "@/lib/i18n";
import {
    elementListensForPlayerInput,
    type WidgetBlueprintOwnerScope,
} from "@/lib/ui-editor/blueprint-runtime/widgetPrivateBlueprintHeads";
import type { UISurfaceDiagnostic } from "../types";

const MIN_HIT_AREA = 20 * 20;

/**
 * Where this surface's widgets keep their blueprints.
 *
 * Optional because a caller may have no blueprint document to hand - a preview built from a
 * document alone. Every one of the rules below is about an element the player is meant to reach, so
 * without it they can only see the element-shaped wiring, which is the older of the two spellings
 * and no longer the one the editor writes. See `widgetPrivateBlueprintHeads`.
 */
export type InteractionDiagnosticsScope = WidgetBlueprintOwnerScope & {
    blueprintDocument?: BlueprintDocument;
};

export function collectInteractionDiagnostics(
    document: UIDocument,
    elements: UIElement[],
    scope: InteractionDiagnosticsScope,
): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];

    for (const el of elements) {
        if (!elementListensForPlayerInput(el, scope, scope.blueprintDocument)) {
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
