/**
 * Per-execution data outputs produced by exec nodes.
 * Comments in English per project convention.
 */

const BLUEPRINT_NODE_OUTPUT_VALUES_KEY = "__nlBlueprintNodeOutputValues";

type NodeOutputStore = Record<string, Record<string, unknown>>;

function readStore(blueprintLocals: Record<string, unknown> | undefined): NodeOutputStore | undefined {
    const raw = blueprintLocals?.[BLUEPRINT_NODE_OUTPUT_VALUES_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    return raw as NodeOutputStore;
}

function getOrCreateStore(blueprintLocals: Record<string, unknown>): NodeOutputStore {
    const existing = readStore(blueprintLocals);
    if (existing) {
        return existing;
    }
    const store: NodeOutputStore = {};
    blueprintLocals[BLUEPRINT_NODE_OUTPUT_VALUES_KEY] = store;
    return store;
}

export function writeBlueprintNodeOutputValues(
    blueprintLocals: Record<string, unknown>,
    nodeId: string,
    outputValues: Record<string, unknown>,
): void {
    getOrCreateStore(blueprintLocals)[nodeId] = { ...outputValues };
}

export function readBlueprintNodeOutputValue(
    blueprintLocals: Record<string, unknown> | undefined,
    nodeId: string,
    portId: string,
): unknown {
    const values = readStore(blueprintLocals)?.[nodeId];
    if (!values || !Object.prototype.hasOwnProperty.call(values, portId)) {
        return undefined;
    }
    return values[portId];
}
