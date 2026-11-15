import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { resolveBlueprintEventHeadTypesForUiSlot } from "@shared/types/blueprint/graph";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import { getWidgetLogicApi, getWidgetLogicEvent, listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { translate } from "@/lib/i18n";
import {
    resolveWidgetPrivateBlueprintId,
    widgetPrivateBlueprintHasSlotHead,
    type WidgetBlueprintOwnerScope,
} from "@/lib/ui-editor/blueprint-runtime/widgetPrivateBlueprintHeads";
import { collectScriptedElements } from "../scriptedElements";
import type { UISurfaceDiagnostic } from "../types";

const MIN_HIT_AREA = 20 * 20;

/** A value binding on either of these drives the property at runtime, whatever it rests at. */
const VISIBLE_BINDING_PATH = "layout.visible";
const OPACITY_BINDING_PATH = "layout.opacity";

// The host fans these out even to hidden widgets, independently of their position or size.
const AMBIENT_EVENT_IDS = new Set([
    "onAnyBroadcast", "onBroadcast", "windowFullscreenChanged", "windowFocusChanged",
    "savedVariableChanged", "persistentVariableChanged",
]);

// These listeners need the widget mounted, but take input from the window rather than its hit area.
const WINDOW_INPUT_EVENT_IDS = new Set(["keyDown", "keyUp", "gamepadButtonDown", "gamepadButtonUp"]);

function listeningInputs(el: UIElement, scope: InteractionDiagnosticsScope): { mounted: boolean; positioned: boolean } {
    if (!getWidgetLogicApi(el.type)?.supportsPrivateBlueprint) {
        return { mounted: false, positioned: false };
    }
    let mounted = false;
    let positioned = false;
    for (const slotId of listWidgetLogicEventIds(el.type)) {
        if (AMBIENT_EVENT_IDS.has(slotId) || getWidgetLogicEvent(el.type, slotId)?.dispatchKind !== "interaction") {
            continue;
        }
        if (!widgetPrivateBlueprintHasSlotHead(scope.blueprintDocument, scope, el, slotId)) {
            continue;
        }
        mounted = true;
        positioned ||= !WINDOW_INPUT_EVENT_IDS.has(slotId);
        if (positioned) {
            break;
        }
    }
    return { mounted, positioned };
}

/** A fan-out event can run on a hidden widget and change its own visibility or opacity. */
function ownAmbientBlueprintCanRun(el: UIElement, scope: InteractionDiagnosticsScope): boolean {
    const document = scope.blueprintDocument;
    const id = resolveWidgetPrivateBlueprintId(document, scope, el.id);
    const blueprint = id ? document?.blueprints?.[id] : undefined;
    if (!blueprint) {
        return false;
    }
    const headTypes = new Set(
        [...AMBIENT_EVENT_IDS].flatMap(slot => resolveBlueprintEventHeadTypesForUiSlot(slot, el.type)),
    );
    return Object.values(blueprint.graphs.events ?? {}).some(layer => {
        // Script handlers are not visible in the blueprint document.
        if (layer.script) {
            return true;
        }
        const graph = layer.graph;
        return Object.values(graph?.nodes ?? {}).some(node =>
            headTypes.has(node.type) && graph?.edges?.some(edge => edge.from.nodeId === node.id && edge.from.port === "then"),
        );
    });
}

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
        const listens = listeningInputs(el, scope);
        if (!listens.mounted) {
            continue;
        }

        const { visible, opacity, width, height } = el.layout;
        const op = opacity ?? 1;
        const hitArea = Math.abs(width) * Math.abs(height);
        const scripted = namedByBlueprints.has(el.id)
            || ((visible === false || op <= 0.01) && ownAmbientBlueprintCanRun(el, scope));

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

        if (listens.positioned && visible !== false && op <= 0.01 && !scripted && !el.valueBindings?.[OPACITY_BINDING_PATH]) {
            out.push({
                id: `ix:opaque-events:${el.id}`,
                severity: "warning",
                source: "interaction",
                message: translate("blueprint.diagnostics.interaction.opaqueEvents", { name: el.name ?? el.type }),
                hint: translate("blueprint.diagnostics.interaction.opaqueEventsHint"),
                elementId: el.id,
            });
        }

        if (listens.positioned && !isUIElementFlowLayoutChild(document, el) && hitArea > 0 && hitArea < MIN_HIT_AREA) {
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
