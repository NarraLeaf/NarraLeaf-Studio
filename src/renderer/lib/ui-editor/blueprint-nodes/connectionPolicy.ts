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
