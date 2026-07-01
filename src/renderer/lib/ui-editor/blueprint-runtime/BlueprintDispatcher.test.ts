import { describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import {
    countBlueprintBroadcastListeners,
    dispatchBlueprintBroadcastEvent,
    dispatchBlueprintElementClickEvent,
    dispatchGlobalBlueprintEvent,
    dispatchSurfaceBlueprintEvent,
    dispatchBlueprintUiEvent,
} from "./BlueprintDispatcher";
import {
    acquireBlueprintExecutionLocals,
    acquireBlueprintWidgetLocals,
    releaseBlueprintWidgetLocals,
} from "./blueprintWidgetLocals";
import { DebugBridge } from "./DebugBridge";
import { BlueprintExecutionManager } from "./BlueprintExecutionManager";
import { createExplicitBlueprintVariableRef } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";

describe("BlueprintDispatcher", () => {
    it("does not emit output when a supported widget event has no event head", async () => {
        const blueprintId = "bp-widget";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
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
            persistentVariables: {},
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

    it("dispatches an Element Click listener bound to another same-surface element", async () => {
        const blueprintId = "bp-panel";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Panel Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "panel" },
                    frontend: "visual",
                    programKind: "graph",
                    members: { variables: {}, fields: {}, functions: {} },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                dialogNext: {
                                    id: "dialogNext",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                                                params: {
                                                    surfaceId: "surface",
                                                    elementId: "interaction",
                                                    elementType: "nl.container",
                                                },
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
                "widgetMain:surface:panel": {
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
                    mount: { kind: "slot", slotId: "dialog" },
                },
            ],
            elements: {
                root: {
                    id: "root",
                    type: "nl.root",
                    parentId: null,
                    childrenIds: ["interaction", "panel"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                interaction: {
                    id: "interaction",
                    type: "nl.container",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                panel: {
                    id: "panel",
                    type: "nl.container",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 40, y: 100, width: 240, height: 60 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintElementClickEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            target: { surfaceId: "surface", elementId: "interaction", elementType: "nl.container" },
            eventPayload: { x: 12, y: 34, button: 0 },
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
            persistentVariables: {},
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

    it("dispatches mounted widget keyboard event payload outputs", async () => {
        const blueprintId = "bp-button-keyboard-payload";
        releaseBlueprintWidgetLocals("surface", "button", blueprintId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Button Keyboard Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "button" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            keyName: { id: "keyName", name: "keyName", valueType: "string", defaultValue: "" },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                keyDown: {
                                    id: "keyDown",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN },
                                            setKey: {
                                                id: "setKey",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "keyName" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setKey", port: "in" } },
                                            { from: { nodeId: "head", port: "key" }, to: { nodeId: "setKey", port: "value" } },
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
            eventName: "keyDown",
            eventPayload: {
                key: "Enter",
                code: "Enter",
                repeat: false,
                altKey: false,
                ctrlKey: false,
                shiftKey: false,
                metaKey: false,
            },
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
        expect(locals.keyName).toBe("Enter");
        releaseBlueprintWidgetLocals("surface", "button", blueprintId);
    });

    it("passes list item event payload outputs into data-pin consumers", async () => {
        const blueprintId = "bp-list-item-payload";
        releaseBlueprintWidgetLocals("surface", "list", blueprintId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "List Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "list" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            selectedKey: { id: "selectedKey", name: "selectedKey", valueType: "string", defaultValue: "" },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                itemClick: {
                                    id: "itemClick",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK },
                                            setKey: {
                                                id: "setKey",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "selectedKey" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setKey", port: "in" } },
                                            { from: { nodeId: "head", port: "key" }, to: { nodeId: "setKey", port: "value" } },
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
                "widgetMain:surface:list": {
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
                    childrenIds: ["list"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                list: {
                    id: "list",
                    type: "nl.list",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 100, height: 80 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "list",
            eventName: "itemClick",
            eventPayload: { index: 1, count: 3, key: "choice-b", item: { label: "Choice B" } },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        const locals = acquireBlueprintWidgetLocals(
            "surface",
            "list",
            blueprintId,
            blueprintDocument.blueprints[blueprintId]!,
        );
        expect(locals.selectedKey).toBe("choice-b");
        releaseBlueprintWidgetLocals("surface", "list", blueprintId);
    });

    it("dispatches global and surface lifecycle event heads", async () => {
        const globalBlueprintId = "bp-global";
        const surfaceBlueprintId = "bp-surface";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [globalBlueprintId]: {
                    id: globalBlueprintId,
                    name: "Global Logic",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            booted: { id: "booted", name: "booted", valueType: "string", defaultValue: "" },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                appBoot: {
                                    id: "appBoot",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT },
                                            setBooted: {
                                                id: "setBooted",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "booted", value: "yes" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setBooted", port: "in" } },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
                [surfaceBlueprintId]: {
                    id: surfaceBlueprintId,
                    name: "Surface Logic",
                    owner: { kind: "surfaceMain", surfaceId: "surface" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            initialized: {
                                id: "initialized",
                                name: "initialized",
                                valueType: "string",
                                defaultValue: "",
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
                                surfaceInit: {
                                    id: "surfaceInit",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT },
                                            setInitialized: {
                                                id: "setInitialized",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "initialized", value: "yes" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setInitialized", port: "in" } },
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
                    activeBlueprintId: surfaceBlueprintId,
                    privateBlueprintIds: [surfaceBlueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchGlobalBlueprintEvent({
            blueprintDocument,
            eventName: "appBoot",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });
        await dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            surfaceId: "surface",
            eventName: "surfaceInit",
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(
            acquireBlueprintExecutionLocals({
                blueprintDocument,
                currentBlueprintId: globalBlueprintId,
            }).booted,
        ).toBe("yes");
        expect(
            acquireBlueprintExecutionLocals({
                blueprintDocument,
                currentBlueprintId: surfaceBlueprintId,
                surfaceId: "surface",
            }).initialized,
        ).toBe("yes");
    });

    it("dispatches surface mouse click event payloads to surface blueprints", async () => {
        const surfaceBlueprintId = "bp-surface-click";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [surfaceBlueprintId]: {
                    id: surfaceBlueprintId,
                    name: "Surface Click",
                    owner: { kind: "surfaceMain", surfaceId: "surface" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            mouseX: { id: "mouseX", name: "mouseX", valueType: "float", defaultValue: 0 },
                            mouseY: { id: "mouseY", name: "mouseY", valueType: "float", defaultValue: 0 },
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
                                            setY: {
                                                id: "setY",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "mouseY" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setX", port: "in" } },
                                            { from: { nodeId: "setX", port: "next" }, to: { nodeId: "setY", port: "in" } },
                                            { from: { nodeId: "head", port: "x" }, to: { nodeId: "setX", port: "value" } },
                                            { from: { nodeId: "head", port: "y" }, to: { nodeId: "setY", port: "value" } },
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
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            surfaceId: "surface",
            eventName: "mouseClick",
            eventPayload: { x: 42, y: 9 },
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
        expect(locals.mouseX).toBe(42);
        expect(locals.mouseY).toBe(9);
    });

    it("cancels pending surface graph executions when their runtime scope closes", async () => {
        vi.useFakeTimers();
        try {
            const surfaceBlueprintId = "bp-surface-cancel";
            const runtimeScopeId = "surface:cancel-test";
            const blueprintDocument: BlueprintDocument = {
                schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                persistentVariables: {},
                blueprints: {
                    [surfaceBlueprintId]: {
                        id: surfaceBlueprintId,
                        name: "Surface Cancel",
                        owner: { kind: "surfaceMain", surfaceId: "surface" },
                        frontend: "visual",
                        programKind: "graph",
                        members: {
                            variables: {
                                initialized: {
                                    id: "initialized",
                                    name: "initialized",
                                    valueType: "string",
                                    defaultValue: "no",
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
                                    surfaceInit: {
                                        id: "surfaceInit",
                                        graph: {
                                            nodes: {
                                                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT },
                                                delay: {
                                                    id: "delay",
                                                    type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                                                    params: { duration: 1 },
                                                },
                                                setInitialized: {
                                                    id: "setInitialized",
                                                    type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                    params: { variableId: "initialized", value: "yes" },
                                                },
                                            },
                                            edges: [
                                                { from: { nodeId: "head", port: "then" }, to: { nodeId: "delay", port: "in" } },
                                                { from: { nodeId: "delay", port: "completed" }, to: { nodeId: "setInitialized", port: "in" } },
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
            const debug = new DebugBridge();
            const executionManager = new BlueprintExecutionManager();
            executionManager.openScope(runtimeScopeId);
            const hostAdapter: UIHostAdapter = { host: "player" };

            const dispatch = dispatchSurfaceBlueprintEvent({
                blueprintDocument,
                surfaceId: "surface",
                runtimeScopeId,
                eventName: "surfaceInit",
                hostAdapter,
                debug,
                getSurfaceState: () => undefined,
                setSurfaceState: () => undefined,
                executionManager,
            });

            await Promise.resolve();
            executionManager.closeScope(runtimeScopeId, "Surface unmounted");
            await expect(dispatch).resolves.toBeUndefined();
            await vi.advanceTimersByTimeAsync(1000);

            expect(
                acquireBlueprintExecutionLocals({
                    blueprintDocument,
                    currentBlueprintId: surfaceBlueprintId,
                    surfaceId: "surface",
                    runtimeScopeId,
                }).initialized,
            ).toBe("no");
            expect(debug.snapshot().some(event => event.type === "execution.cancelled")).toBe(true);
            expect(debug.snapshot().some(event => event.type === "execution.error")).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("dispatches global and surface any-key event payloads", async () => {
        const globalBlueprintId = "bp-global-keyboard";
        const surfaceBlueprintId = "bp-surface-keyboard";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [globalBlueprintId]: {
                    id: globalBlueprintId,
                    name: "Global Keyboard",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            lastKey: { id: "lastKey", name: "lastKey", valueType: "string", defaultValue: "" },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                keyDown: {
                                    id: "keyDown",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN },
                                            setKey: {
                                                id: "setKey",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "lastKey" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setKey", port: "in" } },
                                            { from: { nodeId: "head", port: "key" }, to: { nodeId: "setKey", port: "value" } },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
                [surfaceBlueprintId]: {
                    id: surfaceBlueprintId,
                    name: "Surface Keyboard",
                    owner: { kind: "surfaceMain", surfaceId: "surface" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            lastKey: { id: "lastKey", name: "lastKey", valueType: "string", defaultValue: "" },
                        },
                        fields: {},
                        functions: {},
                    },
                    bindings: {},
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                keyUp: {
                                    id: "keyUp",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP },
                                            setKey: {
                                                id: "setKey",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "lastKey" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setKey", port: "in" } },
                                            { from: { nodeId: "head", port: "key" }, to: { nodeId: "setKey", port: "value" } },
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
                    activeBlueprintId: surfaceBlueprintId,
                    privateBlueprintIds: [surfaceBlueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchGlobalBlueprintEvent({
            blueprintDocument,
            eventName: "keyDown",
            eventPayload: {
                key: "Escape",
                code: "Escape",
                repeat: false,
                altKey: false,
                ctrlKey: false,
                shiftKey: false,
                metaKey: false,
            },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });
        await dispatchSurfaceBlueprintEvent({
            blueprintDocument,
            surfaceId: "surface",
            eventName: "keyUp",
            eventPayload: {
                key: " ",
                code: "Space",
                repeat: false,
                altKey: false,
                ctrlKey: false,
                shiftKey: false,
                metaKey: false,
            },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        expect(
            acquireBlueprintExecutionLocals({
                blueprintDocument,
                currentBlueprintId: globalBlueprintId,
            }).lastKey,
        ).toBe("Escape");
        expect(
            acquireBlueprintExecutionLocals({
                blueprintDocument,
                currentBlueprintId: surfaceBlueprintId,
                surfaceId: "surface",
            }).lastKey,
        ).toBe(" ");
    });

    it("filters On Key event heads case-insensitively", async () => {
        const blueprintId = "bp-global-on-key-filter";
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Global On Key",
                    owner: { kind: "globalMain" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            ctrlHeld: { id: "ctrlHeld", name: "ctrlHeld", valueType: "boolean", defaultValue: false },
                            emptyMatched: {
                                id: "emptyMatched",
                                name: "emptyMatched",
                                valueType: "boolean",
                                defaultValue: false,
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
                                escapeDown: {
                                    id: "escapeDown",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
                                                params: { [BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME]: "escape" },
                                            },
                                            setCtrl: {
                                                id: "setCtrl",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "ctrlHeld", value: true },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setCtrl", port: "in" } },
                                        ],
                                    },
                                },
                                emptyKeyDown: {
                                    id: "emptyKeyDown",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN },
                                            setEmpty: {
                                                id: "setEmpty",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "emptyMatched", value: true },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setEmpty", port: "in" } },
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
                    activeBlueprintId: blueprintId,
                    privateBlueprintIds: [blueprintId],
                    initializedFrontend: "visual",
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "player" };

        await dispatchGlobalBlueprintEvent({
            blueprintDocument,
            eventName: "keyDown",
            eventPayload: { key: "Enter", ctrlKey: true },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });
        let locals = acquireBlueprintExecutionLocals({ blueprintDocument, currentBlueprintId: blueprintId });
        expect(locals.ctrlHeld).toBe(false);
        expect(locals.emptyMatched).toBe(false);

        await dispatchGlobalBlueprintEvent({
            blueprintDocument,
            eventName: "keyDown",
            eventPayload: { key: "ESCAPE", ctrlKey: true },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });
        locals = acquireBlueprintExecutionLocals({ blueprintDocument, currentBlueprintId: blueprintId });
        expect(locals.ctrlHeld).toBe(true);
        expect(locals.emptyMatched).toBe(false);
    });

    it("dispatches Page Event payloads to frame widget blueprints", async () => {
        const blueprintId = "bp-frame";
        releaseBlueprintWidgetLocals("surface", "frame", blueprintId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [blueprintId]: {
                    id: blueprintId,
                    name: "Page Component Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "frame" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            eventName: { id: "eventName", name: "eventName", valueType: "string", defaultValue: "" },
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
                                pageEvent: {
                                    id: "pageEvent",
                                    graph: {
                                        nodes: {
                                            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT },
                                            setEvent: {
                                                id: "setEvent",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "eventName" },
                                            },
                                            setPayload: {
                                                id: "setPayload",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "payload" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "setEvent", port: "in" } },
                                            { from: { nodeId: "head", port: "event" }, to: { nodeId: "setEvent", port: "value" } },
                                            { from: { nodeId: "setEvent", port: "next" }, to: { nodeId: "setPayload", port: "in" } },
                                            { from: { nodeId: "head", port: "data" }, to: { nodeId: "setPayload", port: "value" } },
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
                "widgetMain:surface:frame": {
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
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 320, height: 180 },
                    rootElementId: "root",
                },
            ],
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
                    type: "nl.frame",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 100, height: 80 },
                },
            },
        };
        const debug = new DebugBridge();
        const hostAdapter: UIHostAdapter = { host: "app" };

        await dispatchBlueprintUiEvent({
            document,
            blueprintDocument,
            surfaceId: "surface",
            elementId: "frame",
            eventName: "pageEvent",
            eventPayload: { event: "ready", data: { value: 5 } },
            hostAdapter,
            debug,
            getSurfaceState: () => undefined,
            setSurfaceState: () => undefined,
        });

        const locals = acquireBlueprintWidgetLocals(
            "surface",
            "frame",
            blueprintId,
            blueprintDocument.blueprints[blueprintId]!,
        );
        expect(locals.eventName).toBe("ready");
        expect(locals.payload).toEqual({ value: 5 });
        releaseBlueprintWidgetLocals("surface", "frame", blueprintId);
    });

    it("dispatches named broadcasts and counts matching listeners", async () => {
        const blueprintId = "bp-receiver";
        releaseBlueprintWidgetLocals("surface", "receiver", blueprintId);
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
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
            persistentVariables: {},
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
            persistentVariables: {},
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
