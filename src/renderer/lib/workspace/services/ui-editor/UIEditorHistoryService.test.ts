import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { Services } from "../services";
import {
    applyUIDocumentSurfaceSnapshot,
    captureUIDocumentSurfaceSnapshot,
    UIEditorHistoryService,
} from "./UIEditorHistoryService";

function root(id: string, childId: string): UIElement {
    return {
        id,
        type: "nl.root",
        name: id,
        parentId: null,
        childrenIds: [childId],
        layout: { x: 0, y: 0, width: 1280, height: 720, visible: true, opacity: 1 },
    };
}

function rect(id: string, parentId: string, x: number): UIElement {
    return {
        id,
        type: "nl.button",
        name: id,
        parentId,
        childrenIds: [],
        layout: { x, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
    };
}

function documentWithPositions(aX: number, bX: number): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "doc",
        surfaces: [
            {
                id: "surface-a",
                name: "Surface A",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "root-a",
            },
            {
                id: "surface-b",
                name: "Surface B",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1280, height: 720 },
                rootElementId: "root-b",
            },
        ],
        elements: {
            "root-a": root("root-a", "a"),
            a: rect("a", "root-a", aX),
            "root-b": root("root-b", "b"),
            b: rect("b", "root-b", bX),
        },
        meta: {},
    };
}

function emptyBlueprintDocument(): BlueprintDocument {
    return {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        persistentVariables: {},
        blueprints: {},
        ownerRecords: {},
    };
}

function widgetBlueprint(surfaceId: string, elementId: string, blueprintId: string): Blueprint {
    return {
        id: blueprintId,
        name: "Widget",
        owner: { kind: "widgetMain", surfaceId, elementId },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {},
                functions: {},
            },
        },
    };
}

function widgetValueBlueprint(surfaceId: string, elementId: string, blueprintId: string): Blueprint {
    return {
        id: blueprintId,
        name: "Text value",
        owner: { kind: "widgetValue", surfaceId, elementId, propPath: "text" },
        frontend: "visual",
        programKind: "graph",
        program: {
            kind: "graph",
            graphs: {
                events: {},
                functions: {},
            },
        },
    };
}

function createHarness(initialDocument = documentWithPositions(0, 0), initialBlueprint = emptyBlueprintDocument()) {
    const uidoc = {
        document: initialDocument,
        restoreCount: 0,
        getDocument() {
            return this.document;
        },
        restoreDocumentFromHistory(document: UIDocument) {
            this.document = document;
            this.restoreCount += 1;
        },
    };
    const graphDocument = { blueprintDocument: initialBlueprint };
    const graph = {
        getDocument() {
            return graphDocument;
        },
        applyGraphMutation(mutator: (document: typeof graphDocument) => void) {
            mutator(graphDocument);
        },
    };
    const lifecycle = {
        syncCount: 0,
        syncFromUidoc() {
            this.syncCount += 1;
        },
    };
    const history = new UIEditorHistoryService();
    history.setContext({
        project: {} as any,
        services: {
            get(service: Services) {
                if (service === Services.UIDocument) {
                    return uidoc;
                }
                if (service === Services.UIGraph) {
                    return graph;
                }
                if (service === Services.UIBlueprintLifecycle) {
                    return lifecycle;
                }
                throw new Error(`Unexpected service ${service}`);
            },
        } as any,
    });
    return { history, uidoc, graphDocument, lifecycle };
}

describe("UIEditorHistoryService", () => {
    it("captures only the requested surface in UI document history snapshots", () => {
        const document = documentWithPositions(12, 34);

        const snapshot = captureUIDocumentSurfaceSnapshot(document, "surface-a");

        expect(snapshot.surfaces.map(surface => surface.id)).toEqual(["surface-a"]);
        expect(Object.keys(snapshot.elements).sort()).toEqual(["a", "root-a"]);
        expect(snapshot.elements.b).toBeUndefined();
        expect(snapshot.elements["root-b"]).toBeUndefined();
    });

    it("applies a surface document snapshot without touching other surfaces", () => {
        const current = documentWithPositions(12, 34);
        const target = documentWithPositions(99, 0);

        const next = applyUIDocumentSurfaceSnapshot(current, target, "surface-a");

        expect(next.elements.a.layout.x).toBe(99);
        expect(next.elements.b.layout.x).toBe(34);
        expect(next.surfaces.map(surface => surface.id)).toEqual(["surface-a", "surface-b"]);
    });

    it("keeps undo and redo isolated per surface", () => {
        const { history, uidoc } = createHarness();

        const beforeA = history.captureSnapshot("surface-a");
        uidoc.document = documentWithPositions(10, 0);
        history.record({ surfaceId: "surface-a", before: beforeA, after: history.captureSnapshot("surface-a") });

        const beforeB = history.captureSnapshot("surface-b");
        uidoc.document = documentWithPositions(10, 20);
        history.record({ surfaceId: "surface-b", before: beforeB, after: history.captureSnapshot("surface-b") });

        expect(history.undo("surface-a")).toBe(true);
        expect(uidoc.document.elements.a.layout.x).toBe(0);
        expect(uidoc.document.elements.b.layout.x).toBe(20);

        expect(history.redo("surface-a")).toBe(true);
        expect(uidoc.document.elements.a.layout.x).toBe(10);
        expect(uidoc.document.elements.b.layout.x).toBe(20);
    });

    it("clears redo after a new edit following undo", () => {
        const { history, uidoc } = createHarness();

        const before = history.captureSnapshot("surface-a");
        uidoc.document = documentWithPositions(1, 0);
        history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });
        history.undo("surface-a");

        const nextBefore = history.captureSnapshot("surface-a");
        uidoc.document = documentWithPositions(2, 0);
        history.record({ surfaceId: "surface-a", before: nextBefore, after: history.captureSnapshot("surface-a") });

        expect(history.canRedo("surface-a")).toBe(false);
    });

    it("trims undo history to the configured limit", () => {
        const { history, uidoc } = createHarness();
        history.setLimit(2);

        for (const x of [1, 2, 3]) {
            const before = history.captureSnapshot("surface-a");
            uidoc.document = documentWithPositions(x, 0);
            history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });
        }

        expect(history.undo("surface-a")).toBe(true);
        expect(uidoc.document.elements.a.layout.x).toBe(2);
        expect(history.undo("surface-a")).toBe(true);
        expect(uidoc.document.elements.a.layout.x).toBe(1);
        expect(history.undo("surface-a")).toBe(false);
    });

    it("restores private blueprint resources coupled to UI edits", () => {
        const { history, uidoc, graphDocument } = createHarness();
        const before = history.captureSnapshot("surface-a");
        const blueprint = widgetBlueprint("surface-a", "a", "bp-a");

        graphDocument.blueprintDocument = {
            ...emptyBlueprintDocument(),
            blueprints: {
                "bp-a": blueprint,
            },
            ownerRecords: {
                "widgetMain:surface-a:a": {
                    activeBlueprintId: "bp-a",
                    privateBlueprintIds: ["bp-a"],
                    initializedFrontend: "visual",
                },
            },
        };
        uidoc.document = documentWithPositions(5, 0);
        history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });

        expect(history.undo("surface-a")).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords["widgetMain:surface-a:a"]).toBeUndefined();
        expect(graphDocument.blueprintDocument.blueprints["bp-a"]).toBeUndefined();

        expect(history.redo("surface-a")).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords["widgetMain:surface-a:a"]?.activeBlueprintId).toBe("bp-a");
        expect(graphDocument.blueprintDocument.blueprints["bp-a"]?.owner.kind).toBe("widgetMain");
    });

    it("restores widgetValue blueprint resources coupled to UI edits", () => {
        const { history, uidoc, graphDocument } = createHarness();
        const before = history.captureSnapshot("surface-a");
        const blueprint = widgetValueBlueprint("surface-a", "a", "bp-value-a");

        graphDocument.blueprintDocument = {
            ...emptyBlueprintDocument(),
            blueprints: {
                "bp-value-a": blueprint,
            },
            ownerRecords: {
                "widgetValue:surface-a:a:text": {
                    activeBlueprintId: "bp-value-a",
                    privateBlueprintIds: ["bp-value-a"],
                    initializedFrontend: "visual",
                },
            },
        };
        uidoc.document = {
            ...documentWithPositions(5, 0),
            elements: {
                ...documentWithPositions(5, 0).elements,
                a: {
                    ...documentWithPositions(5, 0).elements.a!,
                    valueBindings: {
                        text: { kind: "blueprintValue", blueprintId: "bp-value-a", valueType: "string" },
                    },
                },
            },
        };
        history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });

        expect(history.undo("surface-a")).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords["widgetValue:surface-a:a:text"]).toBeUndefined();
        expect(graphDocument.blueprintDocument.blueprints["bp-value-a"]).toBeUndefined();

        expect(history.redo("surface-a")).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords["widgetValue:surface-a:a:text"]?.activeBlueprintId).toBe("bp-value-a");
        expect(graphDocument.blueprintDocument.blueprints["bp-value-a"]?.owner.kind).toBe("widgetValue");
        expect(uidoc.document.elements.a.valueBindings?.text).toEqual({
            kind: "blueprintValue",
            blueprintId: "bp-value-a",
            valueType: "string",
        });
    });
});
