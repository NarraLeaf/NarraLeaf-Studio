/**
 * Unified exec + data connection validation (single source for canvas + IR checks).
 * Comments in English per project convention.
 */

import {
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
    isBlueprintElementValueType,
} from "@shared/types/blueprint/valueTypes";
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
        return areDataValueTypesCompatible(sourceValueType, targetValueType);
    }
    return true;
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
