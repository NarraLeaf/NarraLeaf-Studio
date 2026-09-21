import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import {
    buildAccessibleBlueprintVariableOptions,
    createExplicitBlueprintVariableRef,
    listEffectiveBlueprintVariables,
    parseBlueprintVariableRef,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import {
    announceBlueprintStateWrite,
    blueprintVariableRecordStateKey,
    blueprintVariableStateKey,
    isStateWriteNoticeable,
} from "./blueprintStateWrites";

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

/**
 * Key on the per-execution locals object holding the current blueprint's raw lifecycle record, so
 * Memo nodes can park a value there for as long as the blueprint instance is alive.
 *
 * Memo deliberately does not use the node-output store: that one is created fresh per execution, and
 * a Memo whose value vanished the moment its event finished would be readable only from the branch
 * that wrote it - the least useful half of what the node is for. Living in the variable record gives
 * it the lifetime a Var has, including being dropped when the widget unmounts.
 */
export const BLUEPRINT_MEMO_RECORD_KEY = "__nlBlueprintMemoRecord";

/** Prefix for Memo slots inside a blueprint's variable record; keeps them clear of author variables. */
export const BLUEPRINT_MEMO_SLOT_PREFIX = "__nlMemo\0";

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
    // The last owner kind, so it is not a test: a kind added to `BlueprintOwnerRef` without a branch
    // above would fail to compile here rather than silently share this one's key space.
    return `storyAction\0${owner.blueprintId}\0${blueprint.id}`;
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
        // Memo slots are not declared anywhere, so they would be pruned as "a variable that no longer
        // exists" on the next acquire - which is every execution.
        if (!(id in defaults) && !id.startsWith(BLUEPRINT_MEMO_SLOT_PREFIX)) {
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

/**
 * What one execution's view of the variables reports as it is used.
 *
 * `onRead` is how a value binding learns which variables its graph read, so it can be re-run when
 * one of them is written; `origin` is who is doing the writing, so that binding is not re-run by its
 * own writes. See `blueprintStateWrites`.
 */
export type BlueprintVariableObserver = {
    onRead?: (stateKey: string) => void;
    origin?: unknown;
};

/**
 * One variable on an execution's locals, read and written through to the record it lives in.
 *
 * Every write is announced, from whatever graph and whatever host made it: the variable is the same
 * record for all of them, so a binding anywhere that read it has to hear about it.
 */
function defineVariableAccessor(
    target: Record<string, unknown>,
    key: string,
    storeRef: Record<string, unknown>,
    storeKey: string,
    variableId: string,
    observer: BlueprintVariableObserver | undefined,
): void {
    const stateKey = blueprintVariableStateKey(storeKey, variableId);
    Object.defineProperty(target, key, {
        enumerable: true,
        configurable: true,
        get: () => {
            observer?.onRead?.(stateKey);
            return storeRef[variableId];
        },
        set: value => {
            const previous = storeRef[variableId];
            storeRef[variableId] = value;
            if (isStateWriteNoticeable(previous, value)) {
                announceBlueprintStateWrite(stateKey, observer?.origin);
            }
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
    /** See {@link BlueprintVariableObserver}; only a value binding's evaluation passes one. */
    observer?: BlueprintVariableObserver;
}): Record<string, unknown> {
    const current = input.blueprintDocument.blueprints[input.currentBlueprintId];
    if (!current) {
        return {};
    }

    const out: Record<string, unknown> = {};
    const storesByBlueprintId = new Map<string, { key: string; record: Record<string, unknown> }>();
    const options = buildAccessibleBlueprintVariableOptions({
        doc: input.blueprintDocument,
        currentBlueprintId: input.currentBlueprintId,
        surfaceId: input.surfaceId,
    });

    // Acquired up front rather than as a side effect of the variable loop below: a blueprint that
    // declares no variables contributes no options, and its Memo nodes would have nowhere to live.
    const currentKey = blueprintVariableStoreKey(current, input.runtimeScopeId, input.elementInstanceKey);
    const currentRecord = acquireVariableStore(currentKey, current);
    storesByBlueprintId.set(input.currentBlueprintId, { key: currentKey, record: currentRecord });
    Object.defineProperty(out, BLUEPRINT_MEMO_RECORD_KEY, {
        enumerable: false,
        configurable: true,
        value: currentRecord,
    });

    for (const option of options) {
        const bp = input.blueprintDocument.blueprints[option.blueprintId];
        if (!bp) {
            continue;
        }
        let variableStore = storesByBlueprintId.get(option.blueprintId);
        if (!variableStore) {
            const key = blueprintVariableStoreKey(bp, input.runtimeScopeId, input.elementInstanceKey);
            variableStore = { key, record: acquireVariableStore(key, bp) };
            storesByBlueprintId.set(option.blueprintId, variableStore);
        }
        const explicitKey = createExplicitBlueprintVariableRef(option.blueprintId, option.variableId);
        defineVariableAccessor(out, explicitKey, variableStore.record, variableStore.key, option.variableId, input.observer);
        if (option.blueprintId === input.currentBlueprintId) {
            defineVariableAccessor(out, option.variableId, variableStore.record, variableStore.key, option.variableId, input.observer);
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

/**
 * Drop the lifecycle locals an unmounting element owns for one blueprint.
 *
 * Matches on a bounded prefix plus the blueprint id rather than rebuilding the key, because the
 * create path keys by owner kind and appends an instance segment for elements inside a component or a
 * list row. Rebuilding it here is what went wrong before: the key was built by a second function that
 * knew about neither, so an element with an instance key kept its store forever, and a component
 * instance's store - a different key form entirely - was never deleted at all. Coming back to a screen
 * then found the variables from last time still in place.
 *
 * The `\0` after the element id bounds the match, so no other element's stores can be caught by it.
 */
export function releaseBlueprintWidgetLocals(
    surfaceId: string,
    elementId: string,
    blueprintId: string,
    runtimeScopeId?: string,
    options?: { componentId?: string },
): void {
    const prefixes = [`widget\0${runtimeScopeId ?? surfaceId}\0${elementId}\0`];
    if (options?.componentId) {
        prefixes.push(`componentWidget\0${options.componentId}\0${elementId}\0`);
    }
    const suffix = `\0${blueprintId}`;
    for (const key of [...store.keys()]) {
        if (key.endsWith(suffix) && prefixes.some(prefix => key.startsWith(prefix))) {
            store.delete(key);
            // The next read gets the defaults back, which is a write as far as anyone showing one of
            // these variables is concerned.
            announceBlueprintStateWrite(blueprintVariableRecordStateKey(key));
        }
    }
}
