import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { translate } from "@/lib/i18n";
import {
    elementListensForPlayerInput,
    type WidgetBlueprintOwnerScope,
} from "@/lib/ui-editor/blueprint-runtime/widgetPrivateBlueprintHeads";
import { collectScriptedElements } from "../scriptedElements";
import type { UISurfaceDiagnostic } from "../types";

const MIN_HIT_AREA = 20 * 20;

/** A value binding on either of these drives the property at runtime, whatever it rests at. */
const VISIBLE_BINDING_PATH = "layout.visible";
const OPACITY_BINDING_PATH = "layout.opacity";

/**
 * Where this surface's widgets keep their blueprints.
 *
 * Optional because a caller may have no blueprint document to hand - a preview built from a
 * document alone. Every rule below is about an element the player is meant to reach, and whether
 * anything answers a player is written only in the blueprint document, so without it these rules
 * claim nothing rather than guessing. See `widgetPrivateBlueprintHeads`.
 */
export type InteractionDiagnosticsScope = WidgetBlueprintOwnerScope & {
    blueprintDocument?: BlueprintDocument;
    /**
     * `collectScriptedElements(blueprintDocument).named`, when the caller has already walked the
     * document for another rule. Read from the document when absent.
     */
    elementsNamedByBlueprints?: ReadonlySet<string>;
};

/**
 * Hidden or transparent at rest is only a finding when nothing changes it. A widget named by a
 * blueprint, or whose visibility or opacity is bound, is shown by the game rather than by the
 * editor - which is how every tab, viewer and confirmation panel is built - so its resting value
 * says nothing about whether the player will reach it.
 */
export function collectInteractionDiagnostics(
    document: UIDocument,
    elements: UIElement[],
    scope: InteractionDiagnosticsScope,
): UISurfaceDiagnostic[] {
    const out: UISurfaceDiagnostic[] = [];
    const namedByBlueprints = scope.elementsNamedByBlueprints ?? collectScriptedElements(scope.blueprintDocument).named;

    for (const el of elements) {
        if (!elementListensForPlayerInput(el, scope, scope.blueprintDocument)) {
            continue;
        }

        const { visible, opacity, width, height } = el.layout;
        const op = opacity ?? 1;
        const scripted = namedByBlueprints.has(el.id);

        if (visible === false && !scripted && !el.valueBindings?.[VISIBLE_BINDING_PATH]) {
            out.push({
                id: `ix:hidden-events:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: translate("blueprint.diagnostics.interaction.hiddenEvents", { name: el.name ?? el.type }),
                hint: translate("blueprint.diagnostics.interaction.hiddenEventsHint"),
                elementId: el.id,
            });
        }

        if (visible !== false && op <= 0.01 && !scripted && !el.valueBindings?.[OPACITY_BINDING_PATH]) {
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
