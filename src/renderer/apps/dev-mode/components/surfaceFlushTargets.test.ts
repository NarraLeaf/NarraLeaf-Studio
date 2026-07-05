import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { widgetMainOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { collectSurfaceFlushElementIds } from "./surfaceFlushTargets";

describe("collectSurfaceFlushElementIds", () => {
    it("includes value-bound elements and widgets with flush logic", () => {
        const surface: UISurface = {
            id: "dialog",
            name: "Dialog",
            host: "player",
            kind: "stageSurface",
            designSize: { width: 320, height: 180 },
            rootElementId: "root",
            mount: { kind: "slot", slotId: "dialog" },
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
                    childrenIds: ["value", "flush", "legacy", "plain"],
                    layout: { x: 0, y: 0, width: 320, height: 180 },
                },
                value: {
                    id: "value",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 0, width: 80, height: 40 },
                    valueBindings: {
                        text: { kind: "blueprintValue", blueprintId: "bp-value", valueType: "string" },
                    },
                },
                flush: {
                    id: "flush",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 50, width: 80, height: 40 },
                },
                legacy: {
                    id: "legacy",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 100, width: 80, height: 40 },
                    behavior: {
                        events: {
                            flush: { kind: "blueprintEvent", blueprintId: "legacy-bp", eventId: "flush" },
                        },
                    },
                },
                plain: {
                    id: "plain",
                    type: "nl.text",
                    parentId: "root",
                    childrenIds: [],
                    layout: { x: 0, y: 140, width: 80, height: 40 },
                },
            },
        };
        const blueprintDocument: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            persistentVariables: {},
            blueprints: {
                "flush-bp": {
                    id: "flush-bp",
                    name: "Flush logic",
                    owner: { kind: "widgetMain", surfaceId: "dialog", elementId: "flush" },
                    frontend: "visual",
                    programKind: "graph",
                    members: { variables: {}, fields: {}, functions: {} },
                    program: {
                        kind: "graph",
                        graphs: {
                            events: {
                                flush: {
                                    id: "flush",
                                    graph: {
                                        nodes: {
                                            head: {
                                                id: "head",
                                                type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
                                                params: {},
                                            },
                                            value: {
                                                id: "value",
                                                type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                                                params: { value: "ok" },
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
                [widgetMainOwnerKey("dialog", "flush")]: {
                    activeBlueprintId: "flush-bp",
                    privateBlueprintIds: ["flush-bp"],
                    initializedFrontend: "visual",
                },
            },
        };

        expect(collectSurfaceFlushElementIds({ document, blueprintDocument, surface })).toEqual([
            "value",
            "flush",
            "legacy",
        ]);
    });
});
