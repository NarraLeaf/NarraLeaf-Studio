/**
 * Unified exec + data connection validation (single source for canvas + IR checks).
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
} from "@shared/types/blueprint/graph";
import {
    areBlueprintElementValueTypesCompatible,
    BLUEPRINT_VALUE_TYPE_ARRAY,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET,
    BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE,
    BLUEPRINT_VALUE_TYPE_RECT,
    blueprintArrayElementType,
    isBlueprintElementValueType,
} from "@shared/types/blueprint/valueTypes";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import {
    isUIStructValueType,
    structsAreCompatible,
    UI_STRUCT_VALUE_TYPE_ANY,
    uiStructIdFromValueType,
} from "@shared/types/ui-editor/struct";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";

function readParamString(params: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = params?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function resolvePinValueType(input: {
    nodeType: string;
    portId: string;
    pinValueType?: string;
    params?: Record<string, unknown>;
}): string | undefined {
    if (
        (input.nodeType === BLUEPRINT_NODE_TYPE_LOCAL_GET && input.portId === "value") ||
        (input.nodeType === BLUEPRINT_NODE_TYPE_LOCAL_SET && input.portId === "value") ||
        (input.nodeType === BLUEPRINT_NODE_TYPE_PERSISTENT_GET && input.portId === "value") ||
        (input.nodeType === BLUEPRINT_NODE_TYPE_PERSISTENT_SET && input.portId === "value")
    ) {
        return readParamString(input.params, BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE) ?? input.pinValueType;
    }
    return input.pinValueType;
}

/**
 * Whether a value of one struct type may flow into a pin of another.
 *
 * Structs widen into `json` and `any`, so every pin that took the untyped object before it had a
 * shape still takes it - a graph wired before its source was typed keeps every wire. Nothing narrows
 * into a struct except `any`: an untyped object has no declared fields, and a field reader fed one
 * would be offering a list of fields the value may not have.
 *
 * Two different ids are compared by shape, which is the struct library's own rule (`structsAreCompatible`).
 * An id this function cannot resolve - a list's own shape, which lives in the interface document -
 * is left to the field checks rather than refused here: refusing it would cut a wire whose only
 * fault is that the shape it carries is out of this function's sight.
 */
function areStructValueTypesCompatible(sourceType: string, targetType: string): boolean {
    const sourceIsStruct = isUIStructValueType(sourceType);
    const targetIsStruct = isUIStructValueType(targetType);
    if (sourceIsStruct && !targetIsStruct) {
        return targetType === "json" || targetType === "any";
    }
    if (!sourceIsStruct) {
        return sourceType === "any";
    }
    if (targetType === UI_STRUCT_VALUE_TYPE_ANY || sourceType === UI_STRUCT_VALUE_TYPE_ANY) {
        return true;
    }
    const sourceStruct = resolveUIStruct(null, uiStructIdFromValueType(sourceType));
    const targetStruct = resolveUIStruct(null, uiStructIdFromValueType(targetType));
    if (!sourceStruct || !targetStruct) {
        return true;
    }
    return structsAreCompatible(sourceStruct, targetStruct);
}

/**
 * Whether an array whose item type may be known can flow into a pin.
 *
 * `array<T>` is only ever an output (see `blueprintArrayValueType`), and it goes everywhere a plain
 * array goes. Two typed arrays compare by their items.
 */
function areArrayValueTypesCompatible(sourceType: string, targetType: string): boolean {
    const sourceElement = blueprintArrayElementType(sourceType);
    const targetElement = blueprintArrayElementType(targetType);
    if (sourceElement !== undefined && targetElement !== undefined) {
        return areDataValueTypesCompatible(sourceElement, targetElement);
    }
    if (sourceElement !== undefined) {
        return targetType === BLUEPRINT_VALUE_TYPE_ARRAY || targetType === "json" || targetType === "any";
    }
    return sourceType === BLUEPRINT_VALUE_TYPE_ARRAY || sourceType === "any";
}

function areDataValueTypesCompatible(sourceType: string | undefined, targetType: string | undefined): boolean {
    if (!sourceType || !targetType) {
        return true;
    }
    if (sourceType === targetType) {
        return true;
    }
    if (isBlueprintElementValueType(sourceType) || isBlueprintElementValueType(targetType)) {
        return areBlueprintElementValueTypesCompatible(sourceType, targetType);
    }
    if (isUIStructValueType(sourceType) || isUIStructValueType(targetType)) {
        return areStructValueTypesCompatible(sourceType, targetType);
    }
    if (blueprintArrayElementType(sourceType) !== undefined || blueprintArrayElementType(targetType) !== undefined) {
        return areArrayValueTypesCompatible(sourceType, targetType);
    }
    if (sourceType === BLUEPRINT_VALUE_TYPE_ARRAY && targetType === "json") {
        return true;
    }
    // Rect widens into `json`, and only Rect does. It is a migration allowance rather than a rule
    // about structured values: `Get Bounds` and the Rect literal both published `json` until Rect
    // became a value type of its own, so graphs authored before that feed rectangles straight into
    // Get JSON Field and must keep working. Vector2D stays narrow - it never was a `json` pin, and
    // a test above this file pins that down. Narrowing is not the reverse of either: an arbitrary
    // object is not a rect.
    if (sourceType === BLUEPRINT_VALUE_TYPE_RECT && targetType === "json") {
        return true;
    }
    if (
        sourceType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET &&
        targetType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE
    ) {
        return true;
    }
    if (
        sourceType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE &&
        targetType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE
    ) {
        return true;
    }
    if (sourceType === "string" && targetType === BLUEPRINT_VALUE_TYPE_IMAGE_ASSET_NULLABLE) {
        return true;
    }
    if (sourceType === "integer" && targetType === "float") {
        return true;
    }
    if (targetType === "string" && (sourceType === "integer" || sourceType === "float")) {
        return true;
    }
    return sourceType === "any" || targetType === "any";
}

export function isValidBlueprintPinConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
    sourceParams?: Record<string, unknown>;
    targetParams?: Record<string, unknown>;
}): boolean {
    const src = blueprintNodeRegistry.resolveCatalogEntryForNode(params.sourceType, params.sourceParams);
    const tgt = blueprintNodeRegistry.resolveCatalogEntryForNode(params.targetType, params.targetParams);
    const outPin = src.pins.find(p => p.id === params.sourcePort && p.kind === "output");
    const inPin = tgt.pins.find(p => p.id === params.targetPort && p.kind === "input");
    if (!outPin || !inPin) {
        return false;
    }
    if (outPin.semantic !== inPin.semantic) {
        return false;
    }
    if (outPin.semantic === "data") {
        const sourceValueType = resolvePinValueType({
            nodeType: params.sourceType,
            portId: params.sourcePort,
            pinValueType: outPin.valueType,
            params: params.sourceParams,
        });
        const targetValueType = resolvePinValueType({
            nodeType: params.targetType,
            portId: params.targetPort,
            pinValueType: inPin.valueType,
            params: params.targetParams,
        });
        if (areDataValueTypesCompatible(sourceValueType, targetValueType)) {
            return true;
        }
        return areDeclaredDataValueTypesCompatible(params);
    }
    return true;
}

/** A node's params as the node declares them: what the editor worked out for its pins taken off. */
export function withoutInferredPinTypes(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!params || !(BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES in params)) {
        return params;
    }
    const { [BLUEPRINT_NODE_PARAM_INFERRED_PIN_TYPES]: _inferred, ...rest } = params;
    return rest;
}

/**
 * Whether the pair fits by the types the two nodes declare, before anything was worked out from the
 * wires.
 *
 * A type the editor works out (`graphStructTypeInference.ts`) is a promise added on top of the one a
 * node declares, never one taken away. Get Field declared `any` for as long as it only read list rows,
 * and the shipped templates wire it into `json` and `string` pins; typing its output as the field's
 * type must not turn those wires red. So a pair the declared types accept stays accepted, and what the
 * worked-out types add is only what the declared ones could not say - a struct arriving at a reader of
 * that struct.
 */
function areDeclaredDataValueTypesCompatible(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
    sourceParams?: Record<string, unknown>;
    targetParams?: Record<string, unknown>;
}): boolean {
    const sourceParams = withoutInferredPinTypes(params.sourceParams);
    const targetParams = withoutInferredPinTypes(params.targetParams);
    if (sourceParams === params.sourceParams && targetParams === params.targetParams) {
        return false;
    }
    const outPin = blueprintNodeRegistry
        .resolveCatalogEntryForNode(params.sourceType, sourceParams)
        .pins.find(p => p.id === params.sourcePort && p.kind === "output");
    const inPin = blueprintNodeRegistry
        .resolveCatalogEntryForNode(params.targetType, targetParams)
        .pins.find(p => p.id === params.targetPort && p.kind === "input");
    if (!outPin || !inPin) {
        return false;
    }
    return areDataValueTypesCompatible(
        resolvePinValueType({ nodeType: params.sourceType, portId: params.sourcePort, pinValueType: outPin.valueType, params: sourceParams }),
        resolvePinValueType({ nodeType: params.targetType, portId: params.targetPort, pinValueType: inPin.valueType, params: targetParams }),
    );
}

/** Exec-only shortcut for legacy call sites */
export function isValidBlueprintExecConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
    sourceParams?: Record<string, unknown>;
    targetParams?: Record<string, unknown>;
}): boolean {
    return isValidBlueprintPinConnection(params);
}
