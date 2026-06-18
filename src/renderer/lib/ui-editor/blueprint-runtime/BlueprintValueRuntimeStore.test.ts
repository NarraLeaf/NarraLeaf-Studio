import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_STATE_GET,
} from "@shared/types/blueprint/graph";
import { UI_FRAME_ELEMENT_TYPE } from "@shared/types/ui-editor/frame";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { BlueprintValueRuntimeStore, mergeElementWithBlueprintValues } from "./BlueprintValueRuntimeStore";

function initGraph(): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            value: { id: "value", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "init" } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "value", port: "value" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function literalInitGraph(nodeType: string, value: unknown): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            value: { id: "value", type: nodeType, params: { value } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "value", port: "value" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function stateFlushGraph(): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
            state: { id: "state", type: BLUEPRINT_NODE_TYPE_STATE_GET, params: { scope: "surface", key: "title" } },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "state", port: "result" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function blueprintDocument(): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            "bp-value": {
                id: "bp-value",
                name: "Text value",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: "text", propPath: "text" },
                frontend: "visual",
                programKind: "graph",
                members: { variables: {}, fields: {}, functions: {} },
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            init: { id: "init", graph: initGraph() },
                            flush: { id: "flush", graph: stateFlushGraph() },
                        },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {
            "widgetValue:surface:text:text": {
                activeBlueprintId: "bp-value",
                privateBlueprintIds: ["bp-value"],
                initializedFrontend: "visual",
            },
        },
    };
}

function singleValueBlueprintDocument(input: {
    blueprintId: string;
    elementId: string;
    propPath: string;
    valueType: "string" | "json";
    graph: BlueprintGraphIr;
}): BlueprintDocument {
    const ownerKey = `widgetValue:surface:${input.elementId}:${input.propPath}`;
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            [input.blueprintId]: {
                id: input.blueprintId,
                name: "Value",
                owner: { kind: "widgetValue", surfaceId: "surface", elementId: input.elementId, propPath: input.propPath },
                frontend: "visual",
                programKind: "graph",
                members: { variables: {}, fields: {}, functions: {} },
                meta: { valueType: input.valueType },
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            init: { id: "init", graph: input.graph },
                        },
                        functions: {},
                    },
                },
            },
        },
        ownerRecords: {
            [ownerKey]: {
                activeBlueprintId: input.blueprintId,
                privateBlueprintIds: [input.blueprintId],
                initializedFrontend: "visual",
            },
        },
    };
}

function uiDocument(): { document: UIDocument; surface: UISurface } {
    const surface: UISurface = {
        id: "surface",
        name: "Surface",
        host: "player",
        kind: "stageSurface",
        designSize: { width: 320, height: 180 },
        rootElementId: "root",
        mount: { kind: "slot", slotId: "onStage" },
    };
    return {
        surface,
        document: {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [surface],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["text"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                text: {
                    id: "text",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 120, height: 40 },
                    props: { text: "literal" },
                    valueBindings: {
                        text: { kind: "blueprintValue", blueprintId: "bp-value", valueType: "string" },
                    },
                },
            },
        },
    };
}

async function waitFor(assertion: () => void): Promise<void> {
    let lastError: unknown;
    for (let i = 0; i < 20; i += 1) {
        try {
            assertion();
            return;
        } catch (err) {
            lastError = err;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    throw lastError;
}

describe("BlueprintValueRuntimeStore", () => {
    it("runs init then flush and lets queued flush update from state", async () => {
        const { document, surface } = uiDocument();
        let stateValue: unknown = "first";
        let changes = 0;
        const hostAdapter = {
            host: "player",
            blueprintRuntime: {
                surfaceId: "surface",
                runtimeScopeId: "surface",
                setSurfaceState: () => undefined,
                getSurfaceState: () => undefined,
                emitDebug: () => undefined,
                dispatchElementBlueprintEvent: async () => undefined,
                hostApi: {
                    state: {
                        get: () => stateValue,
                        set: () => undefined,
                    },
                },
            },
        } as unknown as UIHostAdapter;
        const store = new BlueprintValueRuntimeStore(() => {
            changes += 1;
        });

        store.sync({
            document,
            surface,
            blueprintDocument: blueprintDocument(),
            hostAdapter,
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "first",
            });
        });

        stateValue = "second";
        store.queueFlushAll();

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "second",
            });
        });
        expect(changes).toBeGreaterThanOrEqual(2);
    });

    it("merges resolved button labels", async () => {
        const surface: UISurface = {
            id: "surface",
            name: "Surface",
            host: "player",
            kind: "stageSurface",
            designSize: { width: 320, height: 180 },
            rootElementId: "root",
            mount: { kind: "slot", slotId: "onStage" },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [surface],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["button"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                button: {
                    id: "button",
                    type: "nl.button",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 120, height: 40 },
                    props: { label: "literal" },
                    valueBindings: {
                        label: { kind: "blueprintValue", blueprintId: "bp-button", valueType: "string" },
                    },
                },
            },
        };
        const store = new BlueprintValueRuntimeStore(() => undefined);
        store.sync({
            document,
            surface,
            blueprintDocument: singleValueBlueprintDocument({
                blueprintId: "bp-button",
                elementId: "button",
                propPath: "label",
                valueType: "string",
                graph: literalInitGraph(BLUEPRINT_NODE_TYPE_LITERAL_STRING, "Dynamic"),
            }),
            hostAdapter: { host: "player" },
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "button", "label", "bp-button").hasResolved).toBe(true);
        });
        const merged = mergeElementWithBlueprintValues(document.elements.button!, "surface", store);
        expect(merged.props?.label).toBe("Dynamic");
    });

    it("merges resolved Page params as JSON objects", async () => {
        const surface: UISurface = {
            id: "surface",
            name: "Surface",
            host: "app",
            kind: "appSurface",
            designSize: { width: 320, height: 180 },
            rootElementId: "root",
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [surface],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["frame"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                frame: {
                    id: "frame",
                    type: UI_FRAME_ELEMENT_TYPE,
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 120, height: 40 },
                    props: { params: { title: "literal" } },
                    valueBindings: {
                        params: { kind: "blueprintValue", blueprintId: "bp-frame", valueType: "json" },
                    },
                },
            },
        };
        const store = new BlueprintValueRuntimeStore(() => undefined);
        store.sync({
            document,
            surface,
            blueprintDocument: singleValueBlueprintDocument({
                blueprintId: "bp-frame",
                elementId: "frame",
                propPath: "params",
                valueType: "json",
                graph: literalInitGraph(BLUEPRINT_NODE_TYPE_LITERAL_JSON, { title: "Dynamic", count: 2 }),
            }),
            hostAdapter: { host: "app" },
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "frame", "params", "bp-frame").hasResolved).toBe(true);
        });
        const merged = mergeElementWithBlueprintValues(document.elements.frame!, "surface", store);
        expect(merged.props?.params).toEqual({ title: "Dynamic", count: 2 });
    });
});
