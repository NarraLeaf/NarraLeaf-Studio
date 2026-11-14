import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { behaviorNodeRegistry } from "../behavior-graph/BehaviorNodeRegistry";
import { acquireBlueprintExecutionLocals } from "./blueprintWidgetLocals";
import { dispatchGlobalBlueprintEvent } from "./BlueprintDispatcher";
import { DebugBridge } from "./DebugBridge";

function document(wait: boolean): BlueprintDocument {
    const blueprint = {
        id: wait ? "ordering-with-wait" : "ordering-without-wait",
        name: "Ordering",
        owner: { kind: "globalMain" },
        members: {
            variables: {
                value: { id: "value", name: "value", valueType: "integer", defaultValue: 0 },
                seen: { id: "seen", name: "seen", valueType: "integer", defaultValue: 0 },
            },
            fields: {},
            functions: {},
        },
        bindings: {},
        graphs: {
            events: {
                main: {
                    id: "main",
                    graph: {
                        nodes: {
                            first: { id: "first", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
                            second: { id: "second", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY, params: {} },
                            setOne: { id: "setOne", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: 1 } },
                            wait: { id: "wait", type: "test.ordering.wait", params: {} },
                            setTwo: { id: "setTwo", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "value", value: 2 } },
                            read: { id: "read", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "value" } },
                            record: { id: "record", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "seen" } },
                        },
                        edges: [
                            { from: { nodeId: "first", port: "then" }, to: { nodeId: "setOne", port: "in" } },
                            { from: { nodeId: "setOne", port: "next" }, to: { nodeId: wait ? "wait" : "setTwo", port: "in" } },
                            { from: { nodeId: "wait", port: "next" }, to: { nodeId: "setTwo", port: "in" } },
                            { from: { nodeId: "second", port: "then" }, to: { nodeId: "record", port: "in" } },
                            { from: { nodeId: "read", port: "value" }, to: { nodeId: "record", port: "value" } },
                        ],
                    },
                },
            },
            functions: {},
        },
    };
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: { [blueprint.id]: blueprint },
        ownerRecords: { globalMain: { blueprintId: blueprint.id } },
    } as unknown as BlueprintDocument;
}

function dispatch(blueprintDocument: BlueprintDocument) {
    return dispatchGlobalBlueprintEvent({
        blueprintDocument,
        persistentVariables: {},
        eventName: "gameReady",
        hostAdapter: { host: "player" },
        debug: new DebugBridge(),
        getSurfaceState: () => undefined,
        setSurfaceState: () => undefined,
    });
}

function locals(blueprintDocument: BlueprintDocument): Record<string, unknown> {
    return acquireBlueprintExecutionLocals({
        blueprintDocument,
        currentBlueprintId: blueprintDocument.ownerRecords.globalMain!.blueprintId,
    });
}

describe("event heads and waits", () => {
    it("runs synchronous nodes of the first head before starting the second head", async () => {
        const blueprintDocument = document(false);
        await dispatch(blueprintDocument);
        expect(locals(blueprintDocument).seen).toBe(2);
    });

    it("starts the next head when the first reaches asynchronous work", async () => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        behaviorNodeRegistry.register({
            type: "test.ordering.wait",
            displayName: "Wait",
            execute: async () => {
                await pending;
                return { nextPort: "next" };
            },
        }, { quietOverwrite: true });
        const blueprintDocument = document(true);
        const done = dispatch(blueprintDocument);
        try {
            for (let index = 0; index < 20; index += 1) await Promise.resolve();
            expect(locals(blueprintDocument).seen).toBe(1);
        } finally {
            release();
            await done;
        }
        expect(locals(blueprintDocument).value).toBe(2);
    });
});
