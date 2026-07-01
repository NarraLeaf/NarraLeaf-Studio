import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
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

function elementTextGraph(): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            element: {
                id: "element",
                type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                params: { surfaceId: "surface", elementId: "text-b", elementType: "nl.text" },
            },
            getText: { id: "getText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT, params: {} },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "element", port: "element" }, to: { nodeId: "getText", port: "element" } },
            { from: { nodeId: "getText", port: "text" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function gameNametagGraph(): BlueprintGraphIr {
    return {
        nodes: {
            init: { id: "init", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT, params: {} },
            flush: { id: "flush", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH, params: {} },
            getNametag: { id: "getNametag", type: BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG, params: {} },
            ret: { id: "ret", type: BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE, params: {} },
        },
        edges: [
            { from: { nodeId: "init", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "flush", port: "then" }, to: { nodeId: "ret", port: "in" } },
            { from: { nodeId: "getNametag", port: "nametag" }, to: { nodeId: "ret", port: "value" } },
        ],
    };
}

function blueprintDocument(graph: BlueprintGraphIr = initGraph()): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        persistentVariables: {},
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
                            init: { id: "init", graph },
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
    valueType: "string" | "json" | "float";
    graph: BlueprintGraphIr;
}): BlueprintDocument {
    const ownerKey = `widgetValue:surface:${input.elementId}:${input.propPath}`;
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        persistentVariables: {},
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
                    childrenIds: ["text", "text-b", "other"],
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
                "text-b": {
                    id: "text-b",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 140, y: 0, width: 120, height: 40 },
                    props: { text: "Source A" },
                },
                other: {
                    id: "other",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 60, width: 120, height: 40 },
                    props: { text: "Other A" },
                },
            },
        },
    };
}

function hostAdapterForDocument(
    document: UIDocument,
    onReadText?: (elementId: string) => void,
    options: { getNametag?: () => string | null } = {},
): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            surfaceId: "surface",
            runtimeScopeId: "surface",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {
                widget: {
                    getTextProperties: (elementId: string) => {
                        onReadText?.(elementId);
                        const element = document.elements[elementId];
                        return {
                            text: String(element?.props?.text ?? ""),
                            fontAssetId: null,
                            fontSize: 16,
                            fontWeight: "normal",
                            color: "#ffffff",
                            textAlign: "left",
                            textVerticalAlign: "start",
                            lineHeight: 1.4,
                            textWrapMode: "word",
                            effects: {},
                        };
                    },
                    setTextProperties: async () => undefined,
                    getDisplayableProperties: (elementId: string) => {
                        const layout = document.elements[elementId]?.layout ?? { x: 0, y: 0, width: 0, height: 0 };
                        return {
                            position: { x: layout.x, y: layout.y },
                            size: { width: layout.width, height: layout.height },
                            bounds: { x: layout.x, y: layout.y, width: layout.width, height: layout.height },
                            rotation: layout.rotation ?? 0,
                            opacity: layout.opacity ?? 1,
                            visible: layout.visible !== false,
                        };
                    },
                },
                game: {
                    getNametag: options.getNametag ?? (() => null),
                },
            },
        },
    } as unknown as UIHostAdapter;
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
    it("reruns only when a tracked Element Text dependency changes", async () => {
        const { document, surface } = uiDocument();
        let changes = 0;
        const readElementIds: string[] = [];
        const hostAdapter = hostAdapterForDocument(document, elementId => {
            readElementIds.push(elementId);
        });
        const bpDoc = blueprintDocument(elementTextGraph());
        const store = new BlueprintValueRuntimeStore(() => {
            changes += 1;
        });

        store.sync({
            document,
            surface,
            blueprintDocument: bpDoc,
            hostAdapter,
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "Source A",
            });
        });
        expect(readElementIds).toEqual(["text-b"]);
        expect(changes).toBe(1);

        document.elements.other!.props = { text: "Other B" };
        store.sync({
            document,
            surface,
            blueprintDocument: bpDoc,
            hostAdapter,
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
            hasResolved: true,
            value: "Source A",
        });
        expect(readElementIds).toEqual(["text-b"]);
        expect(changes).toBe(1);

        document.elements["text-b"]!.props = { text: "Source B" };
        store.sync({
            document,
            surface,
            blueprintDocument: bpDoc,
            hostAdapter,
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "Source B",
            });
        });
        expect(readElementIds).toEqual(["text-b", "text-b"]);
        expect(changes).toBe(2);
    });

    it("keeps one pending rerun while evaluation is in flight", async () => {
        const { document, surface } = uiDocument();
        let changes = 0;
        const store = new BlueprintValueRuntimeStore(() => {
            changes += 1;
        });
        const hostAdapter = { host: "player" } as UIHostAdapter;

        store.sync({
            document,
            surface,
            blueprintDocument: blueprintDocument(literalInitGraph(BLUEPRINT_NODE_TYPE_LITERAL_STRING, "first")),
            hostAdapter,
        });
        store.sync({
            document,
            surface,
            blueprintDocument: blueprintDocument(literalInitGraph(BLUEPRINT_NODE_TYPE_LITERAL_STRING, "second")),
            hostAdapter,
        });
        store.sync({
            document,
            surface,
            blueprintDocument: blueprintDocument(literalInitGraph(BLUEPRINT_NODE_TYPE_LITERAL_STRING, "third")),
            hostAdapter,
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "third",
            });
        });
        expect(changes).toBe(2);
    });

    it("merges Game Get Nametag into ordinary Text value bindings", async () => {
        const { document, surface } = uiDocument();
        let nametag: string | null = "Nattou";
        let changes = 0;
        const store = new BlueprintValueRuntimeStore(() => {
            changes += 1;
        });
        const hostAdapter = hostAdapterForDocument(document, undefined, {
            getNametag: () => nametag,
        });
        const bpDoc = blueprintDocument(gameNametagGraph());

        store.sync({
            document,
            surface,
            blueprintDocument: bpDoc,
            hostAdapter,
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "Nattou",
            });
        });
        let merged = mergeElementWithBlueprintValues(document.elements.text!, "surface", store);
        expect(merged.props?.text).toBe("Nattou");

        nametag = "YouKi";
        store.refreshAll();

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "YouKi",
            });
        });
        merged = mergeElementWithBlueprintValues(document.elements.text!, "surface", store);
        expect(merged.props?.text).toBe("YouKi");

        nametag = null;
        store.refreshAll();

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "text", "text", "bp-value")).toEqual({
                hasResolved: true,
                value: "",
            });
        });
        merged = mergeElementWithBlueprintValues(document.elements.text!, "surface", store);
        expect(merged.props?.text).toBe("");
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

    it("merges resolved Slider values as clamped and snapped floats", async () => {
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
                    childrenIds: ["slider"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                slider: {
                    id: "slider",
                    type: "nl.slider",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 240, height: 40 },
                    props: {
                        value: 20,
                        min: 0,
                        max: 100,
                        step: 5,
                        orientation: "horizontal",
                    },
                    valueBindings: {
                        value: { kind: "blueprintValue", blueprintId: "bp-slider", valueType: "float" },
                    },
                },
            },
        };
        const store = new BlueprintValueRuntimeStore(() => undefined);
        store.sync({
            document,
            surface,
            blueprintDocument: singleValueBlueprintDocument({
                blueprintId: "bp-slider",
                elementId: "slider",
                propPath: "value",
                valueType: "float",
                graph: literalInitGraph(BLUEPRINT_NODE_TYPE_LITERAL_FLOAT, 87.5),
            }),
            hostAdapter: { host: "app" },
        });

        await waitFor(() => {
            expect(store.getResolvedValue("surface", "slider", "value", "bp-slider").hasResolved).toBe(true);
        });
        const merged = mergeElementWithBlueprintValues(document.elements.slider!, "surface", store);
        expect(merged.props?.value).toBe(90);
    });
});
