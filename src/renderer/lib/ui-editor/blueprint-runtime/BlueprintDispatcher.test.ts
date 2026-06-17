import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import {
    countBlueprintBroadcastListeners,
    dispatchBlueprintBroadcastEvent,
    dispatchBlueprintUiEvent,
} from "./BlueprintDispatcher";
import {
    acquireBlueprintExecutionLocals,
    acquireBlueprintWidgetLocals,
    releaseBlueprintWidgetLocals,
} from "./blueprintWidgetLocals";
import { DebugBridge } from "./DebugBridge";
import { createExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";

describe("BlueprintDispatcher", () => {
    it("does not emit output when a supported widget event has no event head", async () => {
        const blueprintId = "bp-widget";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Button Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    frontend: "visual",
                    programKind: "graph",
                    members: { variables: {}, fields: {}, functions: {} },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {},
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                "widgetMain:surface:button": {
                    activeBlueprintId: blueprintId,
                    privateBlueprintIds: [blueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
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
                    layout: { x: 0, y: 0, width: 100, height: 32 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "button",
            eventName: "init",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(debug.snapshot()).toEqual([]);
    });

    it("dispatches a documented widget mouse event head", async () => {
        const blueprintId = "bp-container";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Container Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "container" },
                    frontend: "visual",
                    programKind: "graph",
                    members: { variables: {}, fields: {}, functions: {} },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                mouseEnter: {
                                    id: "mouseEnter",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
                                            },
                                        },
                                        edges: [],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                "widgetMain:surface:container": {
                    activeBlueprintId: blueprintId,
                    privateBlueprintIds: [blueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["container"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                container: {
                    id: "container",
                    type: "nl.container",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 100, height: 32 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "container",
            eventName: "mouseEnter",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(debug.snapshot().map(e => e.type)).toEqual([
            "execution.started",
            "node.enter",
            "node.exit",
            "execution.finished",
        ]);
    });

    it("passes event head payload outputs into data-pin consumers", async () => {
        const blueprintId = "bp-button-payload";
        releaseBlueprintWidgetLocals("surface", "button", blueprintId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Button Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            mouseX: { id: "mouseX", name: "mouseX", valueType: "float", defaultValue: 0 },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                mouseClick: {
                                    id: "mouseClick",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                                            setX: {
                                                id: "setX",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "mouseX" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setX", port: "in" } },
                                            { from: { nodeId: "head", port: "x" }, to: { nodeId: "setX", port: "value" } },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                "widgetMain:surface:button": {
                    activeBlueprintId: blueprintId,
                    privateBlueprintIds: [blueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
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
                    layout: { x: 0, y: 0, width: 100, height: 32 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "button",
            eventName: "mouseClick",
            eventPayload: { x: 42, y: 9 },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        const locals = acquireBlueprintWidgetLocals(
            "surface",
            "button",
            blueprintId,
            blueprintDocument.blueprints[blueprintId]!,
        );
        expect(locals.mouseX).toBe(42);
        releaseBlueprintWidgetLocals("surface", "button", blueprintId);
    });

    it("dispatches named broadcasts and counts matching listeners", async () => {
        const blueprintId = "bp-receiver";
        releaseBlueprintWidgetLocals("surface", "receiver", blueprintId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Receiver Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "receiver" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            payload: { id: "payload", name: "payload", valueType: "json", defaultValue: null },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                broadcast: {
                                    id: "broadcast",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
                                                params: { event: "score" },
                                            },
                                            setPayload: {
                                                id: "setPayload",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "payload" },
                                            },
                                        },
                                        edges: [
                                            {
                                                from: { nodeId: "head", port: "then" },
                                                to: { nodeId: "setPayload", port: "in" },
                                            },
                                            {
                                                from: { nodeId: "head", port: "data" },
                                                to: { nodeId: "setPayload", port: "value" },
                                            },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                "widgetMain:surface:receiver": {
                    activeBlueprintId: blueprintId,
                    privateBlueprintIds: [blueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["sender", "receiver"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                sender: {
                    id: "sender",
                    type: "nl.button",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 100, height: 32 },
                },
                receiver: {
                    id: "receiver",
                    type: "nl.container",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 40, width: 100, height: 32 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        expect(
            countBlueprintBroadcastListeners({
                document,
                blueprintDocument,
                surfaceId: "surface",
                eventName: "score",
            }),
        ).toBe(1);

        await dispatchBlueprintBroadcastEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            eventName: "score",
            data: { value: 7 },
            sender: "sender",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        const locals = acquireBlueprintWidgetLocals(
            "surface",
            "receiver",
            blueprintId,
            blueprintDocument.blueprints[blueprintId]!,
        );
        expect(locals.payload).toEqual({ value: 7 });
        releaseBlueprintWidgetLocals("surface", "receiver", blueprintId);
    });

    it("dispatches broadcasts to the active surface blueprint", async () => {
        const surfaceBlueprintId = "bp-surface-broadcast";
        const payloadVarId = "payload";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [surfaceBlueprintId]: {
                    id: surfaceBlueprintId,
                    name: "Page Logic",
                    owner: { kind: "surfaceMain", surfaceId: "surface" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            [payloadVarId]: {
                                id: payloadVarId,
                                name: "payload",
                                valueType: "json",
                                defaultValue: null,
                            },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                broadcast: {
                                    id: "broadcast",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
                                                params: { event: "score" },
                                            },
                                            setPayload: {
                                                id: "setPayload",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: payloadVarId },
                                            },
                                        },
                                        edges: [
                                            {
                                                from: { nodeId: "head", port: "then" },
                                                to: { nodeId: "setPayload", port: "in" },
                                            },
                                            {
                                                from: { nodeId: "head", port: "data" },
                                                to: { nodeId: "setPayload", port: "value" },
                                            },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                "surfaceMain:surface": {
                    activeBlueprintId: surfaceBlueprintId,
                    privateBlueprintIds: [surfaceBlueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        expect(
            countBlueprintBroadcastListeners({
                document,
                blueprintDocument,
                surfaceId: "surface",
                eventName: "score",
            }),
        ).toBe(1);

        await dispatchBlueprintBroadcastEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            eventName: "score",
            data: { value: 11 },
            sender: "sender",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        const locals = acquireBlueprintExecutionLocals({
            blueprintDocument,
            currentBlueprintId: surfaceBlueprintId,
            surfaceId: "surface",
        });
        expect(locals[payloadVarId]).toEqual({ value: 11 });
    });

    it("sets page and global variables from a widget Set Var node", async () => {
        const widgetBlueprintId = "bp-widget-vars";
        const pageBlueprintId = "bp-page-vars";
        const globalBlueprintId = "bp-global-vars";
        const pageVarId = "pageScore";
        const globalVarId = "globalFlag";
        const pageVarRef = createExplicitBlueprintVariableRef(pageBlueprintId, pageVarId);
        const globalVarRef = createExplicitBlueprintVariableRef(globalBlueprintId, globalVarId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {
                [globalBlueprintId]: {
                    id: globalBlueprintId,
                    name: "Global",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            [globalVarId]: {
                                id: globalVarId,
                                name: "shared",
                                valueType: "boolean",
                                defaultValue: false,
                            },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: { kind: "graph", graphs: { events: {}, functions: {} } },
                },
                [pageBlueprintId]: {
                    id: pageBlueprintId,
                    name: "Page",
                    owner: { kind: "surfaceMain", surfaceId: "surface" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            [pageVarId]: {
                                id: pageVarId,
                                name: "shared",
                                valueType: "integer",
                                defaultValue: 0,
                            },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: { kind: "graph", graphs: { events: {}, functions: {} } },
                },
                [widgetBlueprintId]: {
                    id: widgetBlueprintId,
                    name: "Widget",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    frontend: "visual",
                    programKind: "graph",
                    members: { variables: {}, fields: {}, functions: {} },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                mouseClick: {
                                    id: "mouseClick",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK },
                                            setPage: {
                                                id: "setPage",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: pageVarRef, value: 7 },
                                            },
                                            setGlobal: {
                                                id: "setGlobal",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: globalVarRef, value: true },
                                            },
                                        },
                                        edges: [
                                            {
                                                from: { nodeId: "head", port: "then" },
                                                to: { nodeId: "setPage", port: "in" },
                                            },
                                            {
                                                from: { nodeId: "setPage", port: "next" },
                                                to: { nodeId: "setGlobal", port: "in" },
                                            },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
            },
            ownerRecords: {
                globalMain: {
                    activeBlueprintId: globalBlueprintId,
                    privateBlueprintIds: [globalBlueprintId],
                    initializedFrontend: "visual",
                },
                "surfaceMain:surface": {
                    activeBlueprintId: pageBlueprintId,
                    privateBlueprintIds: [pageBlueprintId],
                    initializedFrontend: "visual",
                },
                "widgetMain:surface:button": {
                    activeBlueprintId: widgetBlueprintId,
                    privateBlueprintIds: [widgetBlueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const document: UIDocument = {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "doc",
            name: "Doc",
            surfaces: [
                {
                    id: "surface",
                    name: "Surface",
                    host: "player",
                    kind: "stageSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                    mount: { kind: "slot", slotId: "onStage" },
                },
            ],
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
                    layout: { x: 0, y: 0, width: 100, height: 32 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "button",
            eventName: "mouseClick",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        const locals = acquireBlueprintExecutionLocals({
            blueprintDocument,
            currentBlueprintId: widgetBlueprintId,
            surfaceId: "surface",
            elementId: "button",
        });
        expect(locals[pageVarRef]).toBe(7);
        expect(locals[globalVarRef]).toBe(true);
    });
});
