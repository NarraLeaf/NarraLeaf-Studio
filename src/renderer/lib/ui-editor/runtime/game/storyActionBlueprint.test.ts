import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { ScriptCtx } from "narraleaf-react";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
} from "@shared/types/blueprint/graph";
import { acquireBlueprintExecutionLocals } from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import {
    createExplicitBlueprintVariableRef,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { GLOBAL_MAIN_OWNER_KEY, storyActionOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { createBlueprintFnRef } from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import {
    compileStoryActionBlueprintToScript,
    evaluateStoryActionBlueprintValueSync,
    type CompileStoryActionScriptInput,
} from "./storyActionBlueprint";

/**
 * What a story row's graph reads through `Get Var`.
 *
 * Every run used to be handed an empty locals object, so a `Var` declared in the row's blueprint
 * read as `undefined` whatever its Default said, and a Var of the project blueprint - which the
 * editor offers in the same dropdown - read as `undefined` too.
 */

const ROW_BLUEPRINT_ID = "bp-row";
const GLOBAL_BLUEPRINT_ID = "bp-global";
const COUNT_VAR_ID = "var-count";
const GLOBAL_VAR_ID = "var-chapter";

type Nodes = NonNullable<BlueprintGraphIr["nodes"]>;
type Edges = NonNullable<BlueprintGraphIr["edges"]>;

function blueprintDocument(rowNodes: Nodes, rowEdges: Edges): BlueprintDocument {
    return {
        blueprints: {
            [ROW_BLUEPRINT_ID]: {
                id: ROW_BLUEPRINT_ID,
                name: "Row",
                owner: { kind: "storyAction", blueprintId: ROW_BLUEPRINT_ID },
                graphs: {
                    eventIds: ["layer-call"],
                    events: { "layer-call": { id: "layer-call", graph: { nodes: rowNodes, edges: rowEdges } } },
                    functions: {},
                },
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
            },
            [GLOBAL_BLUEPRINT_ID]: {
                id: GLOBAL_BLUEPRINT_ID,
                name: "Project",
                owner: { kind: "globalMain" },
                graphs: {
                    eventIds: ["layer-vars"],
                    events: {
                        "layer-vars": {
                            id: "layer-vars",
                            graph: {
                                nodes: {
                                    declareChapter: {
                                        id: "declareChapter",
                                        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                                        params: { variableId: GLOBAL_VAR_ID, name: "chapter", valueType: "integer", defaultValue: 1 },
                                    },
                                },
                                edges: [],
                            },
                        },
                    },
                    functions: {},
                },
                members: { variables: {}, fields: {}, functions: {} },
                bindings: {},
            },
        },
        ownerRecords: {
            [storyActionOwnerKey(ROW_BLUEPRINT_ID)]: { blueprintId: ROW_BLUEPRINT_ID },
            [GLOBAL_MAIN_OWNER_KEY]: { blueprintId: GLOBAL_BLUEPRINT_ID },
        },
    } as unknown as BlueprintDocument;
}

/** The row's own `Var count` (Integer, Default 3). */
const declareCount: Nodes[string] = {
    id: "declareCount",
    type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    params: { variableId: COUNT_VAR_ID, name: "count", valueType: "integer", defaultValue: 3 },
} as Nodes[string];

/** On Call -> Return Value, fed by `Get Var <ref>`: what an inline value in a line evaluates. */
function returnVariableDocument(variableRef: string): BlueprintDocument {
    return blueprintDocument(
        {
            declareCount,
            call: { id: "call", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            read: { id: "read", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: variableRef } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        } as Nodes,
        [
            { from: { nodeId: "call", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "read", port: "value" }, to: { nodeId: "ret", port: "value" } },
        ] as Edges,
    );
}

/**
 * On Call -> Set Saved Var "seen" (fed by `Get Var count`) -> Set Var count = 99: a row action that
 * reports what it read, then changes it, so a second run shows whether the change outlived the run.
 */
function recordThenOverwriteDocument(): BlueprintDocument {
    return blueprintDocument(
        {
            declareCount,
            call: { id: "call", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            read: { id: "read", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: COUNT_VAR_ID } },
            record: { id: "record", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-seen" } },
            ninetyNine: { id: "ninetyNine", type: BLUEPRINT_NODE_TYPE_LITERAL_INTEGER, params: { value: 99 } },
            overwrite: { id: "overwrite", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: COUNT_VAR_ID } },
        } as Nodes,
        [
            { from: { nodeId: "call", port: "then" }, to: { nodeId: "record", port: "in" } },
            { from: { nodeId: "read", port: "value" }, to: { nodeId: "record", port: "value" } },
            { from: { nodeId: "record", port: "next" }, to: { nodeId: "overwrite", port: "in" } },
            { from: { nodeId: "ninetyNine", port: "value" }, to: { nodeId: "overwrite", port: "value" } },
        ] as Edges,
    );
}

function input(document: BlueprintDocument): CompileStoryActionScriptInput {
    return {
        blueprintDocument: document,
        persistentVariables: {} as never,
        blueprintId: ROW_BLUEPRINT_ID,
        nlrScene: { name: "scene-1" } as never,
        sceneFnCatalog: { blueprintIds: new Set<string>() },
        sceneVariables: {},
        savedVariables: {
            "var-seen": { id: "var-seen", name: "seen", storageKey: "seen", defaultValue: null } as never,
            "var-fn-seen": { id: "var-fn-seen", name: "fnSeen", storageKey: "fnSeen", defaultValue: null } as never,
        },
        savedNamespace: "saved",
    };
}

/** Save-file namespaces backed by maps, keyed by namespace name. */
function storable(): { namespaces: Map<string, Map<string, unknown>>; getNamespace: (name: string) => unknown } {
    const namespaces = new Map<string, Map<string, unknown>>();
    return {
        namespaces,
        getNamespace: (name: string) => {
            let values = namespaces.get(name);
            if (!values) {
                values = new Map();
                namespaces.set(name, values);
            }
            const store = values;
            return {
                get: (key: string) => store.get(key),
                set: (key: string, value: unknown) => store.set(key, value),
                has: (key: string) => store.has(key),
            };
        },
    };
}

type EngineAwaitable = { isSettled(): boolean };

/** Run a compiled row action the way the engine does, and wait until the story would move on. */
async function runRow(action: unknown, saveFile: ReturnType<typeof storable>): Promise<void> {
    const gameState = {
        game: { getLiveGame: () => ({ getStorable: () => saveFile }) },
        logger: { warn: () => undefined },
        events: { on: () => ({ cancel: () => undefined }) },
    };
    const [engineAction] = (action as { getActions(): Array<{ executeAction(...args: unknown[]): unknown }> }).getActions();
    const awaitable = engineAction.executeAction(gameState, {}) as EngineAwaitable;
    for (let i = 0; i < 50 && !awaitable.isSettled(); i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(awaitable.isSettled()).toBe(true);
}

describe("a story row's Var", () => {
    it("shares its variables among concurrent On Call heads and resets them on the next run", async () => {
        const document = blueprintDocument({
            declareCount,
            first: { id: "first", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            second: { id: "second", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            recordDefault: { id: "recordDefault", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-fn-seen" } },
            set: { id: "set", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: COUNT_VAR_ID, value: 99 } },
            wait: { id: "wait", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 } },
            read: { id: "read", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: COUNT_VAR_ID } },
            record: { id: "record", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-seen" } },
        } as Nodes, [
            { from: { nodeId: "first", port: "then" }, to: { nodeId: "recordDefault", port: "in" } },
            { from: { nodeId: "read", port: "value" }, to: { nodeId: "recordDefault", port: "value" } },
            { from: { nodeId: "recordDefault", port: "next" }, to: { nodeId: "set", port: "in" } },
            { from: { nodeId: "second", port: "then" }, to: { nodeId: "wait", port: "in" } },
            { from: { nodeId: "wait", port: "completed" }, to: { nodeId: "record", port: "in" } },
            { from: { nodeId: "read", port: "value" }, to: { nodeId: "record", port: "value" } },
        ] as Edges);
        const saveFile = storable();
        const action = compileStoryActionBlueprintToScript(input(document));

        await runRow(action, saveFile);
        expect(saveFile.namespaces.get("saved")?.get("fnSeen")).toBe(3);
        expect(saveFile.namespaces.get("saved")?.get("seen")).toBe(99);
        await runRow(action, saveFile);
        expect(saveFile.namespaces.get("saved")?.get("fnSeen")).toBe(3);
        expect(saveFile.namespaces.get("saved")?.get("seen")).toBe(99);
    });

    it("shares the row's variables with its Fn while keeping the call's own execution", async () => {
        const document = blueprintDocument({
            declareCount,
            call: { id: "call", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            setBefore: { id: "setBefore", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: COUNT_VAR_ID, value: 99 } },
            invoke: { id: "invoke", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: { fnRef: createBlueprintFnRef(ROW_BLUEPRINT_ID, "fn") } },
            readAfter: { id: "readAfter", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: COUNT_VAR_ID } },
            recordAfter: { id: "recordAfter", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-seen" } },
            fn: { id: "fn", type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: { name: "Change Count" } },
            readFn: { id: "readFn", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: COUNT_VAR_ID } },
            recordFn: { id: "recordFn", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-fn-seen" } },
            setFn: { id: "setFn", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: COUNT_VAR_ID, value: 77 } },
        } as Nodes, [
            { from: { nodeId: "call", port: "then" }, to: { nodeId: "setBefore", port: "in" } },
            { from: { nodeId: "setBefore", port: "next" }, to: { nodeId: "invoke", port: "in" } },
            { from: { nodeId: "invoke", port: "next" }, to: { nodeId: "recordAfter", port: "in" } },
            { from: { nodeId: "readAfter", port: "value" }, to: { nodeId: "recordAfter", port: "value" } },
            { from: { nodeId: "fn", port: "then" }, to: { nodeId: "recordFn", port: "in" } },
            { from: { nodeId: "readFn", port: "value" }, to: { nodeId: "recordFn", port: "value" } },
            { from: { nodeId: "recordFn", port: "next" }, to: { nodeId: "setFn", port: "in" } },
        ] as Edges);
        const runInput = input(document);
        runInput.sceneFnCatalog = { blueprintIds: new Set([ROW_BLUEPRINT_ID]) };
        const saveFile = storable();

        await runRow(compileStoryActionBlueprintToScript(runInput), saveFile);
        expect(saveFile.namespaces.get("saved")?.get("fnSeen")).toBe(99);
        expect(saveFile.namespaces.get("saved")?.get("seen")).toBe(77);
    });

    it("keeps concurrent Fn arguments and results with their own calls", async () => {
        const snapshot = {
            name: "Echo",
            params: [{ pinId: "param_1_value", name: "input", valueType: "string" }],
            returns: [{ pinId: "ret_1_value", name: "result", valueType: "string" }],
        };
        const callParams = (value: string) => ({
            fnRef: createBlueprintFnRef(ROW_BLUEPRINT_ID, "fn"),
            __fnSignatureSnapshot: snapshot,
            param_1_value: value,
        });
        const document = blueprintDocument({
            first: { id: "first", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            second: { id: "second", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL, params: {} },
            callFirst: { id: "callFirst", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: callParams("first") },
            callSecond: { id: "callSecond", type: BLUEPRINT_NODE_TYPE_FN_CALL, params: callParams("second") },
            saveFirst: { id: "saveFirst", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-seen" } },
            saveSecond: { id: "saveSecond", type: BLUEPRINT_NODE_TYPE_SAVED_SET, params: { savedVariableId: "var-fn-seen" } },
            fn: { id: "fn", type: BLUEPRINT_NODE_TYPE_FN_HEAD, params: {
                name: "Echo", __fnParamPinIds: ["param_1_value"],
                __fnParamPinLabels: { param_1_value: "input" }, __fnParamPinTypes: { param_1_value: "string" },
            } },
            wait: { id: "wait", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 0 } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_FN_RETURN, params: {
                __fnReturnPinIds: ["ret_1_value"], __fnReturnPinLabels: { ret_1_value: "result" },
                __fnReturnPinTypes: { ret_1_value: "string" },
            } },
        } as Nodes, [
            { from: { nodeId: "first", port: "then" }, to: { nodeId: "callFirst", port: "in" } },
            { from: { nodeId: "second", port: "then" }, to: { nodeId: "callSecond", port: "in" } },
            { from: { nodeId: "callFirst", port: "next" }, to: { nodeId: "saveFirst", port: "in" } },
            { from: { nodeId: "callFirst", port: "ret_1_value" }, to: { nodeId: "saveFirst", port: "value" } },
            { from: { nodeId: "callSecond", port: "next" }, to: { nodeId: "saveSecond", port: "in" } },
            { from: { nodeId: "callSecond", port: "ret_1_value" }, to: { nodeId: "saveSecond", port: "value" } },
            { from: { nodeId: "fn", port: "then" }, to: { nodeId: "wait", port: "in" } },
            { from: { nodeId: "wait", port: "completed" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "fn", port: "param_1_value" }, to: { nodeId: "ret", port: "ret_1_value" } },
        ] as Edges);
        const runInput = input(document);
        runInput.sceneFnCatalog = { blueprintIds: new Set([ROW_BLUEPRINT_ID]) };
        const saveFile = storable();
        await runRow(compileStoryActionBlueprintToScript(runInput), saveFile);
        expect(saveFile.namespaces.get("saved")?.get("seen")).toBe("first");
        expect(saveFile.namespaces.get("saved")?.get("fnSeen")).toBe("second");
    });

    it("reads its declared default in an inline value", () => {
        const saveFile = storable();
        const ctx = { storable: saveFile } as unknown as ScriptCtx;
        expect(evaluateStoryActionBlueprintValueSync(input(returnVariableDocument(COUNT_VAR_ID)), ctx)).toBe(3);
    });

    it("reads its declared default in a row action, and starts from it again on the next run", async () => {
        const saveFile = storable();
        const action = compileStoryActionBlueprintToScript(input(recordThenOverwriteDocument()));

        await runRow(action, saveFile);
        expect(saveFile.namespaces.get("saved")?.get("seen")).toBe(3);

        // The first run set the Var to 99 before it finished. A row's own Vars do not outlive the
        // run: the story saves and rolls back, and they would do neither.
        await runRow(action, saveFile);
        expect(saveFile.namespaces.get("saved")?.get("seen")).toBe(3);
    });

    it("reads a project Var as the live value the interface holds", () => {
        const document = returnVariableDocument(createExplicitBlueprintVariableRef(GLOBAL_BLUEPRINT_ID, GLOBAL_VAR_ID));
        const ctx = { storable: storable() } as unknown as ScriptCtx;

        expect(evaluateStoryActionBlueprintValueSync(input(document), ctx)).toBe(1);

        // A Surface blueprint writes the project Var, as a title-screen button would.
        const surfaceLocals = acquireBlueprintExecutionLocals({ blueprintDocument: document, currentBlueprintId: GLOBAL_BLUEPRINT_ID });
        surfaceLocals[GLOBAL_VAR_ID] = 4;

        expect(evaluateStoryActionBlueprintValueSync(input(document), ctx)).toBe(4);
    });
});
