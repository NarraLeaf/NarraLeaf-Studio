import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/graph";
import type { DevModeBundle } from "@shared/types/devMode";
import { createDevModeBlueprintHostApi } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import {
    acquireBlueprintWidgetLocals,
    releaseBlueprintWidgetLocals,
} from "@/lib/ui-editor/blueprint-runtime/blueprintWidgetLocals";
import { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { createDevModeBlueprintHostAdapter } from "./devModeBlueprintHostAdapter";

describe("createDevModeBlueprintHostAdapter", () => {
    it("continues a widget event bubble from child to parent", async () => {
        const childBlueprintId = "bp-child";
        const parentBlueprintId = "bp-parent";
        releaseBlueprintWidgetLocals("surface", "child", childBlueprintId);
        releaseBlueprintWidgetLocals("surface", "parent", parentBlueprintId);

        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                [childBlueprintId]: {
                    id: childBlueprintId,
                    name: "Child Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "child" },
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
                                            bubble: {
                                                id: "bubble",
                                                type: BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE,
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "bubble", port: "in" } },
                                        ],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                },
                [parentBlueprintId]: {
                    id: parentBlueprintId,
                    name: "Parent Logic",
                    owner: { kind: "widgetMain", surfaceId: "surface", elementId: "parent" },
                    frontend: "visual",
                    programKind: "graph",
                    members: {
                        variables: {
                            bubbled: { id: "bubbled", name: "bubbled", valueType: "string", defaultValue: "no" },
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
                                            literal: {
                                                id: "literal",
                                                type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                                                params: { value: "yes" },
                                            },
                                            set: {
                                                id: "set",
                                                type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
                                                params: { variableId: "bubbled" },
                                            },
                                        },
                                        edges: [
                                            { from: { nodeId: "head", port: "then" }, to: { nodeId: "set", port: "in" } },
                                            { from: { nodeId: "literal", port: "value" }, to: { nodeId: "set", port: "value" } },
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
                "widgetMain:surface:child": {
                    activeBlueprintId: childBlueprintId,
                    privateBlueprintIds: [childBlueprintId],
                    initializedFrontend: "visual",
                },
                "widgetMain:surface:parent": {
                    activeBlueprintId: parentBlueprintId,
                    privateBlueprintIds: [parentBlueprintId],
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
                    childrenIds: ["parent"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                parent: {
                    id: "parent",
                    type: "nl.container",
                    parentId: "root",
                    childrenIds: ["child"],
                    layout: { x: 0, y: 0, width: 120, height: 80 },
                },
                child: {
                    id: "child",
                    type: "nl.button",
                    parentId: "parent",
                    childrenIds: [],
                    layout: { x: 8, y: 8, width: 80, height: 32 },
                },
            },
        };
        const bundle: DevModeBundle = {
            bundleId: "bundle",
            revision: 1,
            timestamp: "2026-07-02T00:00:00.000Z",
            ui: {
                uidoc: document,
                uigraphs: {
                    schemaVersion: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
                    graphs: {},
                    blueprintDocument,
                },
                localBlueprints: blueprintDocument,
                sharedBlueprints: [],
            },
        };
        const debug = new DebugBridge();
        const scope = new ScopeStoreBridge();
        const hostApi = createDevModeBlueprintHostApi({
            document,
            scope,
            activeSurfaceId: "surface",
            emit: event => debug.emit(event),
            onOpenSurface: () => undefined,
            onCloseLayer: () => undefined,
            onWidgetPatch: () => undefined,
            widgetRuntimeStore: new WidgetRuntimeStateStore(),
        });
        const adapter = createDevModeBlueprintHostAdapter({
            bundle,
            surface: document.surfaces[0] as UISurface,
            scopeBridge: scope,
            debug,
            hostApi,
        });

        await adapter.blueprintRuntime?.dispatchElementBlueprintEvent("child", "mouseClick", { x: 4, y: 5, button: 0 });

        const parentLocals = acquireBlueprintWidgetLocals(
            "surface",
            "parent",
            parentBlueprintId,
            blueprintDocument.blueprints[parentBlueprintId]!,
        );
        expect(parentLocals.bubbled).toBe("yes");

        releaseBlueprintWidgetLocals("surface", "child", childBlueprintId);
        releaseBlueprintWidgetLocals("surface", "parent", parentBlueprintId);
    });
});
