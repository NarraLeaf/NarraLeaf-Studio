/**
 * Turn a placed node into another node type where it stands - what a node family's picker does.
 *
 * The node keeps its id, its place and every setting the new type also has, and its wires stay on
 * where they still fit. A pin is matched by id first, then by position among the pins of its kind:
 * the eighteen preference setters each name their one value pin after the preference, and a wire
 * into "BGM Volume" is the same wire into "SFX Volume" once the card has been switched. A wire the
 * new type cannot take - a pin that is gone, a value of another type - is removed, as it would be
 * refused if drawn now; the switch is one step on the undo stack, so nothing it drops is lost.
 */
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { resolveBlueprintNodeEditorCatalogEntryForNode } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintNodeEditorCatalogEntry,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { createGraphNodeForPalette, isValidBlueprintIrExecConnection } from "./graphEditing";
import type { BlueprintGraphVariableTypeInferenceContext } from "./graphVariableTypeInference";

type CatalogPin = BlueprintNodeEditorCatalogEntry["pins"][number];

/** Where each of the old type's pins lands on the new one, by pin id; absent when it has nowhere to go. */
function mapPins(oldPins: readonly CatalogPin[], newPins: readonly CatalogPin[]): Map<string, string> {
    const sameShape = (a: CatalogPin, b: CatalogPin) => a.kind === b.kind && a.semantic === b.semantic;
    const map = new Map<string, string>();
    const taken = new Set<string>();
    for (const pin of oldPins) {
        const same = newPins.find(candidate => candidate.id === pin.id && sameShape(candidate, pin));
        if (same) {
            map.set(pin.id, same.id);
            taken.add(same.id);
        }
    }
    for (const pin of oldPins) {
        if (map.has(pin.id)) {
            continue;
        }
        const index = oldPins.filter(candidate => sameShape(candidate, pin)).indexOf(pin);
        const target = newPins.filter(candidate => sameShape(candidate, pin))[index];
        if (target && !taken.has(target.id)) {
            map.set(pin.id, target.id);
            taken.add(target.id);
        }
    }
    return map;
}

/**
 * Retype `nodeId` to `nextType` inside `ir`, which is changed in place. Returns false, changing
 * nothing, when there is no such node or it already is that type.
 */
export function retypeBlueprintNodeInIr(
    ir: BlueprintGraphIr,
    nodeId: string,
    nextType: string,
    variableTypeContext?: BlueprintGraphVariableTypeInferenceContext,
): boolean {
    const node = ir.nodes?.[nodeId];
    if (!node || node.type === nextType) {
        return false;
    }
    const oldParams = node.params ?? {};
    const oldEntry = resolveBlueprintNodeEditorCatalogEntryForNode(node.type, oldParams);
    const newEntry = resolveBlueprintNodeEditorCatalogEntryForNode(nextType, oldParams);
    const pinMap = mapPins(oldEntry.pins, newEntry.pins);
    const newPinById = new Map(newEntry.pins.map(pin => [pin.id, pin]));

    const params: Record<string, unknown> = { ...oldParams };
    // A setting only the old type had: `On Key Down`'s key means nothing on `Any Key Down`.
    const newFieldKeys = new Set((newEntry.inspectorParams ?? []).map(spec => spec.key));
    for (const spec of oldEntry.inspectorParams ?? []) {
        if (!newFieldKeys.has(spec.key)) {
            delete params[spec.key];
        }
    }
    // A value typed into an input pin follows the pin when the pin it lands on takes the same kind
    // of value, and is dropped otherwise.
    const openLiteralPins = Array.isArray(oldParams[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY])
        ? (oldParams[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY] as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
    const nextOpenLiteralPins: string[] = [];
    const movedLiterals: Record<string, unknown> = {};
    for (const pin of oldEntry.pins) {
        if (pin.kind !== "input" || pin.semantic !== "data" || !pin.allowInlineLiteral) {
            continue;
        }
        const targetId = pinMap.get(pin.id);
        const target = targetId ? newPinById.get(targetId) : undefined;
        const carries = Boolean(target?.allowInlineLiteral && target.valueType === pin.valueType);
        if (pin.id in oldParams && !newFieldKeys.has(pin.id)) {
            delete params[pin.id];
            if (carries) {
                movedLiterals[target!.id] = oldParams[pin.id];
            }
        }
        if (carries && openLiteralPins.includes(pin.id)) {
            nextOpenLiteralPins.push(target!.id);
        }
    }
    Object.assign(params, movedLiterals);
    if (nextOpenLiteralPins.length > 0) {
        params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY] = nextOpenLiteralPins;
    } else {
        delete params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY];
    }
    // What a freshly placed node of the new type starts with, under whatever the old one carried.
    for (const [key, value] of Object.entries(createGraphNodeForPalette(nextType, nodeId).params ?? {})) {
        if (!(key in params)) {
            params[key] = value;
        }
    }

    node.type = nextType;
    node.params = params;

    const edges = ir.edges ?? [];
    const moved = edges.flatMap(edge => {
        const fromPort = edge.from.nodeId === nodeId ? pinMap.get(edge.from.port) : edge.from.port;
        const toPort = edge.to.nodeId === nodeId ? pinMap.get(edge.to.port) : edge.to.port;
        if (!fromPort || !toPort) {
            return [];
        }
        return [{ from: { ...edge.from, port: fromPort }, to: { ...edge.to, port: toPort } }];
    });
    ir.edges = moved.filter(edge => {
        if (edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId) {
            return true;
        }
        return isValidBlueprintIrExecConnection(
            ir,
            {
                source: edge.from.nodeId,
                target: edge.to.nodeId,
                sourceHandle: edge.from.port,
                targetHandle: edge.to.port,
            },
            variableTypeContext,
        );
    });
    return true;
}
