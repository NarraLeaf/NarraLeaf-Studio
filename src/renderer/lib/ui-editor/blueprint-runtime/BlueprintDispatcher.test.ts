import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_EVENT_HEAD_POINTER_ENTER } from "@shared/types/blueprint/graph";
import { dispatchBlueprintUiEvent } from "./BlueprintDispatcher";
import { DebugBridge } from "./DebugBridge";

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

    it("dispatches a newly registered widget pointer event head", async () => {
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
                                pointerEnter: {
                                    id: "pointerEnter",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_POINTER_ENTER,
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
            eventName: "pointerEnter",
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
});
