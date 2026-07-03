import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import {
    buildAccessibleBlueprintVariableOptions,
    createExplicitBlueprintVariableRef,
    listEffectiveBlueprintVariables,
    parseBlueprintVariableRef,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";

function defaultLocalsFromBlueprint(bp: Blueprint): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const v of listEffectiveBlueprintVariables(bp)) {
        const d = v.defaultValue;
        out[v.id] = d === undefined ? null : cloneJsonValue(d);
    }
    return out;
}

function cloneJsonValue<T>(value: T): T {
    if (value === null || typeof value !== "object") {
        return value;
    }
    return JSON.parse(JSON.stringify(value)) as T;
}

const store = new Map<string, Record<string, unknown>>();

function widgetVariableStoreKey(runtimeScopeId: string, elementId: string, blueprintId: string): string {
    return `widget\0${runtimeScopeId}\0${elementId}\0${blueprintId}`;
}

function instanceElementId(elementId: string, elementInstanceKey?: string): string {
    return elementInstanceKey ? `${elementId}\0${elementInstanceKey}` : elementId;
}

function blueprintVariableStoreKey(blueprint: Blueprint, runtimeScopeId?: string, elementInstanceKey?: string): string {
    const owner = blueprint.owner;
    if (owner.kind === "globalMain") {
        return `global\0${blueprint.id}`;
    }
    if (owner.kind === "surfaceMain") {
        return `surface\0${runtimeScopeId ?? owner.surfaceId}\0${blueprint.id}`;
    }
    if (owner.kind === "widgetMain") {
        return `widget\0${runtimeScopeId ?? owner.surfaceId}\0${instanceElementId(owner.elementId, elementInstanceKey)}\0${blueprint.id}`;
    }
    if (owner.kind === "widgetValue") {
        return `widgetValue\0${runtimeScopeId ?? owner.surfaceId}\0${instanceElementId(owner.elementId, elementInstanceKey)}\0${owner.propPath}\0${blueprint.id}`;
    }
    if (owner.kind === "componentWidgetMain") {
        return `componentWidget\0${owner.componentId}\0${instanceElementId(owner.elementId, elementInstanceKey)}\0${blueprint.id}`;
    }
    return `asset\0${owner.assetId}\0${blueprint.id}`;
}

function acquireVariableStore(key: string, bp: Blueprint): Record<string, unknown> {
    let locals = store.get(key);
    if (!locals) {
        locals = defaultLocalsFromBlueprint(bp);
        store.set(key, locals);
        return locals;
    }
    const defaults = defaultLocalsFromBlueprint(bp);
    for (const id of Object.keys(locals)) {
        if (!(id in defaults)) {
            delete locals[id];
        }
    }
    for (const [id, v] of Object.entries(defaults)) {
        if (!(id in locals)) {
            locals[id] = v;
        }
    }
    return locals;
}

function defineVariableAccessor(target: Record<string, unknown>, key: string, storeRef: Record<string, unknown>, variableId: string): void {
    Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: () => storeRef[variableId],
        set: value => {
            storeRef[variableId] = value;
        },
    });
}

/**
 * Mutable blueprint lifecycle locals. Widget owners are released on unmount; owner-level stores stay
 * keyed by their runtime scope and are reused across event dispatches.
 */
export function acquireBlueprintWidgetLocals(
    surfaceId: string,
    elementId: string,
    blueprintId: string,
    bp: Blueprint,
    runtimeScopeId?: string,
): Record<string, unknown> {
    return acquireVariableStore(widgetVariableStoreKey(runtimeScopeId ?? surfaceId, elementId, blueprintId), bp);
}

export function acquireBlueprintExecutionLocals(input: {
    blueprintDocument: BlueprintDocument;
    currentBlueprintId: string;
    surfaceId?: string;
    runtimeScopeId?: string;
    elementId?: string;
    elementInstanceKey?: string;
}): Record<string, unknown> {
    const current = input.blueprintDocument.blueprints[input.currentBlueprintId];
    if (!current) {
        return {};
    }

    const out: Record<string, unknown> = {};
    const storesByBlueprintId = new Map<string, Record<string, unknown>>();
    const options = buildAccessibleBlueprintVariableOptions({
        doc: input.blueprintDocument,
        currentBlueprintId: input.currentBlueprintId,
        surfaceId: input.surfaceId,
    });

    for (const option of options) {
        const bp = input.blueprintDocument.blueprints[option.blueprintId];
        if (!bp) {
            continue;
        }
        let variableStore = storesByBlueprintId.get(option.blueprintId);
        if (!variableStore) {
            variableStore = acquireVariableStore(blueprintVariableStoreKey(bp, input.runtimeScopeId, input.elementInstanceKey), bp);
            storesByBlueprintId.set(option.blueprintId, variableStore);
        }
        const explicitKey = createExplicitBlueprintVariableRef(option.blueprintId, option.variableId);
        defineVariableAccessor(out, explicitKey, variableStore, option.variableId);
        if (option.blueprintId === input.currentBlueprintId) {
            defineVariableAccessor(out, option.variableId, variableStore, option.variableId);
        }
    }

    return out;
}

export function resolveBlueprintLocalValue(input: {
    currentBlueprintId?: string;
    blueprintLocals?: Record<string, unknown>;
    rawRef: unknown;
}): unknown {
    const currentBlueprintId = input.currentBlueprintId;
    if (!currentBlueprintId || !input.blueprintLocals) {
        return undefined;
    }
    const parsed = parseBlueprintVariableRef(input.rawRef, currentBlueprintId);
    if (!parsed) {
        return undefined;
    }
    const key = parsed.explicit ? createExplicitBlueprintVariableRef(parsed.blueprintId, parsed.variableId) : parsed.variableId;
    return input.blueprintLocals[key];
}

export function releaseBlueprintWidgetLocals(
    surfaceId: string,
    elementId: string,
    blueprintId: string,
    runtimeScopeId?: string,
): void {
    store.delete(widgetVariableStoreKey(runtimeScopeId ?? surfaceId, elementId, blueprintId));
}
