import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
} from "@shared/types/blueprint/graph";

export type BlueprintVariableTypeOption = {
    value: string;
    valueType?: string;
};

export type BlueprintGraphVariableTypeInferenceContext = {
    memberVariables?: readonly BlueprintVariableTypeOption[];
    persistentVariables?: readonly BlueprintVariableTypeOption[];
};

function readParamString(params: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = params?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function findOptionValueType(
    rawValue: string | undefined,
    options: readonly BlueprintVariableTypeOption[] | undefined,
): string | undefined {
    if (!rawValue) {
        return undefined;
    }
    return options?.find(option => option.value === rawValue)?.valueType;
}

function isBlueprintVariableRefNode(type: string): boolean {
    return (
        type === BLUEPRINT_NODE_TYPE_LOCAL_GET ||
        type === BLUEPRINT_NODE_TYPE_LOCAL_SET ||
        type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET ||
        type === BLUEPRINT_NODE_TYPE_PERSISTENT_SET
    );
}

export function inferBlueprintVariableValueTypeForNode(
    type: string,
    params: Record<string, unknown> | undefined,
    ctx: BlueprintGraphVariableTypeInferenceContext | undefined,
): string | undefined {
    if (type === BLUEPRINT_NODE_TYPE_LOCAL_GET || type === BLUEPRINT_NODE_TYPE_LOCAL_SET) {
        return findOptionValueType(readParamString(params, "variableId"), ctx?.memberVariables);
    }
    if (type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET || type === BLUEPRINT_NODE_TYPE_PERSISTENT_SET) {
        return findOptionValueType(readParamString(params, "persistentVariableId"), ctx?.persistentVariables);
    }
    return undefined;
}

export function withInferredBlueprintVariableValueTypeParam(
    type: string,
    params: Record<string, unknown> | undefined,
    ctx: BlueprintGraphVariableTypeInferenceContext | undefined,
): Record<string, unknown> | undefined {
    if (!isBlueprintVariableRefNode(type)) {
        return params;
    }
    if (!ctx?.memberVariables && !ctx?.persistentVariables) {
        return params;
    }
    const next = { ...(params ?? {}) };
    const inferred = inferBlueprintVariableValueTypeForNode(type, params, ctx);
    if (inferred) {
        next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE] = inferred;
    } else {
        delete next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE];
    }
    return next;
}

export function withInferredBlueprintVariableValueTypes(
    ir: BlueprintGraphIr,
    ctx: BlueprintGraphVariableTypeInferenceContext | undefined,
): BlueprintGraphIr {
    if (!ctx?.memberVariables && !ctx?.persistentVariables) {
        return ir;
    }
    const nodes = ir.nodes ?? {};
    const nextNodes: Record<string, BlueprintGraphNode> = {};
    let changed = false;
    for (const [nodeId, node] of Object.entries(nodes)) {
        const nextParams = withInferredBlueprintVariableValueTypeParam(node.type, node.params, ctx);
        if (nextParams !== node.params) {
            changed = true;
            nextNodes[nodeId] = { ...node, params: nextParams };
        } else {
            nextNodes[nodeId] = node;
        }
    }
    return changed ? { ...ir, nodes: nextNodes } : ir;
}
