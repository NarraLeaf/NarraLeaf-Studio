import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { Services } from "../services";
import { LocalBlueprintService } from "./LocalBlueprintService";

function graphBlueprint(id = "bp-main"): Blueprint {
    return {
        id,
        name: "Main",
        owner: { kind: "surfaceMain", surfaceId: "surface-a" },
        frontend: "visual",
        programKind: "graph",
        members: {
            variables: {},
            fields: {},
            functions: {},
        },
        program: {
            kind: "graph",
            graphs: {
                events: {
                    mouseClick: {
                        id: "mouseClick",
                        name: "Mouse Click",
                        graph: {
                            nodes: {
                                nodeA: {
                                    id: "nodeA",
                                    type: "test.node",
                                    params: {
                                        value: 1,
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
    };
}

function blueprintDocument(): BlueprintDocument {
    const bp = graphBlueprint();
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {
            [bp.id]: bp,
        },
        ownerRecords: {
            "surfaceMain:surface-a": {
                activeBlueprintId: bp.id,
                privateBlueprintIds: [bp.id],
                initializedFrontend: "visual",
            },
        },
    };
}

function rootElement(): UIElement {
    return {
        id: "root-a",
        type: "nl.root",
        name: "Root",
        parentId: null,
        childrenIds: ["button-a"],
        layout: { x: 0, y: 0, width: 1280, height: 720, visible: true, opacity: 1 },
    };
}

function buttonElement(): UIElement {
    return {
        id: "button-a",
        type: "nl.button",
        name: "Button",
        parentId: "root-a",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
        behavior: {
            events: {
                mouseClick: { kind: "blueprintEvent", blueprintId: "bp-main", eventId: "mouseClick" },
            },
        },
    };
}

function uiDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-doc",
        name: "UI",
        surfaces: [
            {
                id: "surface-a",
                name: "Surface A",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "root-a",
            },
        ],
        elements: {
            "root-a": rootElement(),
            "button-a": buttonElement(),
        },
        meta: {},
    };
}

function createHarness() {
    const graphDocument = { blueprintDocument: blueprintDocument() };
    const uidoc = {
        document: uiDocument(),
        getDocument() {
            return this.document;
        },
        restoreDocumentFromHistory(document: UIDocument) {
            this.document = document;
        },
        stripBlueprintLayerBindings(surfaceId: string, blueprintId: string, layerEventId: string) {
            for (const element of Object.values(this.document.elements)) {
                const events = element.behavior?.events;
                if (!events) {
                    continue;
                }
                for (const [eventName, binding] of Object.entries(events)) {
                    if (
                        binding.kind === "blueprintEvent" &&
                        binding.blueprintId === blueprintId &&
                        binding.eventId === layerEventId
                    ) {
                        events[eventName] = { kind: "noop" };
                    }
                }
            }
        },
    };
    const service = new LocalBlueprintService();
    service.setContext({
        project: {} as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.UIGraph) {
                    return {
                        getDocument() {
                            return graphDocument;
                        },
                        applyGraphMutation(mutator: (document: typeof graphDocument) => void) {
                            mutator(graphDocument);
                        },
                    };
                }
                if (serviceId === Services.UIDocument) {
                    return uidoc;
                }
                if (serviceId === Services.Uuid) {
                    return { generate: () => "generated-id" };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
    });
    return { service, graphDocument, uidoc };
}

describe("LocalBlueprintService history", () => {
    it("undoes and redoes blueprint member edits", () => {
        const { service, graphDocument } = createHarness();

        const created = service.createBlueprintVariable("bp-main", { name: "health", valueType: "integer" });
        expect(graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]?.name).toBe("health");
        expect(graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]?.valueType).toBe("integer");

        expect(service.undoBlueprint("bp-main")).toBe(true);
        expect(graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]).toBeUndefined();

        expect(service.redoBlueprint("bp-main")).toBe(true);
        expect(graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]?.name).toBe("health");
        expect(graphDocument.blueprintDocument.blueprints["bp-main"].members?.variables[created.id]?.valueType).toBe("integer");
    });

    it("clears redo after a new edit following undo", () => {
        const { service } = createHarness();

        service.createBlueprintVariable("bp-main", { name: "health" });
        expect(service.undoBlueprint("bp-main")).toBe(true);

        service.createBlueprintVariable("bp-main", { name: "score" });

        expect(service.canRedoBlueprint("bp-main")).toBe(false);
    });

    it("undoes repeated node parameter edits one committed value at a time", () => {
        const { service, graphDocument } = createHarness();

        service.updateEventGraphIr("bp-main", "mouseClick", ir => {
            const node = ir.nodes?.nodeA;
            if (node) {
                node.params = { ...(node.params ?? {}), value: 2 };
            }
        });
        service.updateEventGraphIr("bp-main", "mouseClick", ir => {
            const node = ir.nodes?.nodeA;
            if (node) {
                node.params = { ...(node.params ?? {}), value: 3 };
            }
        });

        const readValue = () => {
            const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
            if (bp.program.kind !== "graph") {
                return undefined;
            }
            return bp.program.graphs.events.mouseClick?.graph?.nodes?.nodeA?.params?.value;
        };

        expect(readValue()).toBe(3);
        expect(service.undoBlueprint("bp-main")).toBe(true);
        expect(readValue()).toBe(2);
        expect(service.undoBlueprint("bp-main")).toBe(true);
        expect(readValue()).toBe(1);
    });

    it("restores graph connections when undoing an edge deletion", () => {
        const { service, graphDocument } = createHarness();

        service.updateEventGraphIr("bp-main", "mouseClick", ir => {
            ir.nodes = {
                ...(ir.nodes ?? {}),
                nodeB: {
                    id: "nodeB",
                    type: "test.next",
                    params: {},
                },
            };
            ir.edges = [
                { from: { nodeId: "nodeA", port: "next" }, to: { nodeId: "nodeB", port: "in" } },
            ];
        });
        service.updateEventGraphIr("bp-main", "mouseClick", ir => {
            ir.edges = [];
        });

        const readEdges = () => {
            const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
            if (bp.program.kind !== "graph") {
                return undefined;
            }
            return bp.program.graphs.events.mouseClick?.graph?.edges;
        };

        expect(readEdges()).toEqual([]);
        expect(service.undoBlueprint("bp-main")).toBe(true);
        expect(readEdges()).toEqual([
            { from: { nodeId: "nodeA", port: "next" }, to: { nodeId: "nodeB", port: "in" } },
        ]);
    });

    it("restores UI behavior changes recorded in a blueprint transaction", () => {
        const { service, graphDocument, uidoc } = createHarness();

        service.runBlueprintHistoryTransaction("bp-main", () => {
            uidoc.stripBlueprintLayerBindings("surface-a", "bp-main", "mouseClick");
            service.removeEventGraph("bp-main", "mouseClick");
        });

        expect(uidoc.document.elements["button-a"].behavior?.events?.mouseClick.kind).toBe("noop");
        expect(graphDocument.blueprintDocument.blueprints["bp-main"].program.kind).toBe("graph");
        if (graphDocument.blueprintDocument.blueprints["bp-main"].program.kind === "graph") {
            expect(graphDocument.blueprintDocument.blueprints["bp-main"].program.graphs.events.mouseClick).toBeUndefined();
        }

        expect(service.undoBlueprint("bp-main")).toBe(true);

        expect(uidoc.document.elements["button-a"].behavior?.events?.mouseClick).toEqual({
            kind: "blueprintEvent",
            blueprintId: "bp-main",
            eventId: "mouseClick",
        });
        const bp = graphDocument.blueprintDocument.blueprints["bp-main"];
        expect(bp.program.kind).toBe("graph");
        if (bp.program.kind === "graph") {
            expect(bp.program.graphs.events.mouseClick?.name).toBe("Mouse Click");
        }
    });
});
