import { describe, expect, it } from "vitest";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIComponentDefinition, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { HistoryService } from "../history/HistoryService";
import { uiComponentHistoryScope, uiSurfaceHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import {
    applyUIDocumentComponentSnapshot,
    applyUIDocumentSurfaceSnapshot,
    captureUIDocumentComponentSnapshot,
    captureUIDocumentSurfaceSnapshot,
    UIEditorHistoryService,
    uiEditorHistoryScope,
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
        blueprints: {},
        ownerRecords: {},
    };
}

function widgetBlueprint(surfaceId: string, elementId: string, blueprintId: string): Blueprint {
    return {
        id: blueprintId,
        name: "Widget",
        owner: { kind: "widgetMain", surfaceId, elementId },
        graphs: {
            events: {},
            functions: {},
        },
    };
}

function widgetValueBlueprint(surfaceId: string, elementId: string, blueprintId: string): Blueprint {
    return {
        id: blueprintId,
        name: "Text value",
        owner: { kind: "widgetValue", surfaceId, elementId, propPath: "text" },
        graphs: {
            events: {},
            functions: {},
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
    // The stacks live in HistoryService now; this service only knows what a surface snapshot is.
    const historyService = new HistoryService();
    const history = new UIEditorHistoryService();
    const context = {
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
                if (service === Services.History) {
                    return historyService;
                }
                throw new Error(`Unexpected service ${service}`);
            },
        } as any,
        commandLineRun: false,
    };
    historyService.setContext(context);
    history.setContext(context);
    return { history, historyService, uidoc, graphDocument, lifecycle };
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
                    blueprintId: "bp-a",
                },
            },
        };
        uidoc.document = documentWithPositions(5, 0);
        history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });

        expect(history.undo("surface-a")).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords["widgetMain:surface-a:a"]).toBeUndefined();
        expect(graphDocument.blueprintDocument.blueprints["bp-a"]).toBeUndefined();

        expect(history.redo("surface-a")).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords["widgetMain:surface-a:a"]?.blueprintId).toBe("bp-a");
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
                    blueprintId: "bp-value-a",
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
        expect(graphDocument.blueprintDocument.ownerRecords["widgetValue:surface-a:a:text"]?.blueprintId).toBe("bp-value-a");
        expect(graphDocument.blueprintDocument.blueprints["bp-value-a"]?.owner.kind).toBe("widgetValue");
        expect(uidoc.document.elements.a.valueBindings?.text).toEqual({
            kind: "blueprintValue",
            blueprintId: "bp-value-a",
            valueType: "string",
        });
    });
});

/**
 * A component editor runs on a pseudo surface, `component-editor:<id>`, that no page document holds.
 * The same surface-id-speaking service answers for it with the definition's slice and stack.
 */
describe("UIEditorHistoryService for a component definition", () => {
    function withComponents(document: UIDocument, ...components: UIComponentDefinition[]): UIDocument {
        return { ...document, components };
    }

    function definition(id: string, text: string, updatedAt = "2026-01-01T00:00:00.000Z"): UIComponentDefinition {
        return {
            id,
            name: id,
            rootElementId: `${id}-root`,
            updatedAt,
            elements: {
                [`${id}-root`]: { ...rect(`${id}-root`, "", 0), parentId: null, childrenIds: [`${id}-text`] },
                [`${id}-text`]: { ...rect(`${id}-text`, `${id}-root`, 0), type: "nl.text", props: { text } },
            },
        };
    }

    const SLOT_SURFACE = buildUIComponentEditorSurfaceId("slot");

    it("captures the one definition and nothing of the pages or the other definitions", () => {
        const document = withComponents(documentWithPositions(1, 2), definition("slot", "01"), definition("badge", "New"));

        const snapshot = captureUIDocumentComponentSnapshot(document, "slot");

        expect(snapshot).toEqual({ componentId: "slot", component: definition("slot", "01"), structs: {} });
    });

    it("puts a definition back in its own place in the library and touches nothing else", () => {
        const current = withComponents(documentWithPositions(5, 6), definition("slot", "99"), definition("badge", "Hot"));

        const next = applyUIDocumentComponentSnapshot(current, { componentId: "slot", component: definition("slot", "01") });

        expect(next.components?.map(component => component.id)).toEqual(["slot", "badge"]);
        expect(next.components?.[0]?.elements["slot-text"]?.props?.text).toBe("01");
        expect(next.components?.[1]?.elements["badge-text"]?.props?.text).toBe("Hot");
        expect(next.elements.a.layout.x).toBe(5);
    });

    it("undoes and redoes in the definition's scope, apart from the pages'", () => {
        const { history, historyService, uidoc } = createHarness(withComponents(documentWithPositions(0, 0), definition("slot", "01")));

        const before = history.captureSnapshot(SLOT_SURFACE);
        uidoc.document = withComponents(documentWithPositions(0, 0), definition("slot", "02"));
        history.record({ surfaceId: SLOT_SURFACE, before, after: history.captureSnapshot(SLOT_SURFACE) });
        const pageBefore = history.captureSnapshot("surface-a");
        uidoc.document = { ...uidoc.document, elements: documentWithPositions(9, 0).elements };
        history.record({ surfaceId: "surface-a", before: pageBefore, after: history.captureSnapshot("surface-a") });

        expect(historyService.describe().map(stack => [stack.scopeId, stack.undo])).toEqual([
            [uiComponentHistoryScope("slot"), 1],
            [uiSurfaceHistoryScope("surface-a"), 1],
        ]);
        expect(history.undo(SLOT_SURFACE)).toBe(true);
        expect(uidoc.document.components?.[0]?.elements["slot-text"]?.props?.text).toBe("01");
        expect(uidoc.document.elements.a.layout.x).toBe(9);
        expect(history.redo(SLOT_SURFACE)).toBe(true);
        expect(uidoc.document.components?.[0]?.elements["slot-text"]?.props?.text).toBe("02");
    });

    it("puts a component widget's private blueprint back with the definition", () => {
        const { history, uidoc, graphDocument } = createHarness(withComponents(documentWithPositions(0, 0), definition("slot", "01")));
        const ownerKey = "componentWidgetMain:slot:slot-text";
        graphDocument.blueprintDocument = {
            ...emptyBlueprintDocument(),
            blueprints: {
                "bp-text": { ...widgetBlueprint("unused", "slot-text", "bp-text"), owner: { kind: "componentWidgetMain", componentId: "slot", elementId: "slot-text" } },
                "bp-page": widgetBlueprint("surface-a", "a", "bp-page"),
            },
            ownerRecords: {
                [ownerKey]: { blueprintId: "bp-text" },
                "widgetMain:surface-a:a": { blueprintId: "bp-page" },
            },
        };
        const before = history.captureSnapshot(SLOT_SURFACE);
        expect(Object.keys(before.blueprint.ownerRecords)).toEqual([ownerKey]);

        delete graphDocument.blueprintDocument.ownerRecords[ownerKey];
        delete graphDocument.blueprintDocument.blueprints["bp-text"];
        uidoc.document = withComponents(documentWithPositions(0, 0), definition("slot", "02"));
        history.record({ surfaceId: SLOT_SURFACE, before, after: history.captureSnapshot(SLOT_SURFACE) });

        expect(history.undo(SLOT_SURFACE)).toBe(true);
        expect(graphDocument.blueprintDocument.ownerRecords[ownerKey]?.blueprintId).toBe("bp-text");
        expect(graphDocument.blueprintDocument.ownerRecords["widgetMain:surface-a:a"]?.blueprintId).toBe("bp-page");
    });

    it("does not make a step of a write that only moved the definition's time stamp", () => {
        const { history, historyService, uidoc } = createHarness(withComponents(documentWithPositions(0, 0), definition("slot", "01")));

        const before = history.captureSnapshot(SLOT_SURFACE);
        uidoc.document = withComponents(documentWithPositions(0, 0), definition("slot", "01", "2026-02-02T00:00:00.000Z"));
        history.record({ surfaceId: SLOT_SURFACE, before, after: history.captureSnapshot(SLOT_SURFACE) });

        expect(historyService.canUndo(uiComponentHistoryScope("slot"))).toBe(false);
    });

    it("tells its listeners which editor surface a stack belongs to, whole", () => {
        const { history, uidoc } = createHarness(withComponents(documentWithPositions(0, 0), definition("slot", "01")));
        const heard: string[] = [];
        // The bridge from the workspace's stacks to this event is made in `init`.
        (history as any).init(undefined);
        history.on("historyChanged", ({ surfaceId }) => heard.push(surfaceId));

        const before = history.captureSnapshot(SLOT_SURFACE);
        uidoc.document = withComponents(documentWithPositions(0, 0), definition("slot", "02"));
        history.record({ surfaceId: SLOT_SURFACE, before, after: history.captureSnapshot(SLOT_SURFACE) });
        // A page whose id carries the separator, as the built-in main page's does.
        history.record({ surfaceId: "narraleaf-studio:main-surface", before, after: history.captureSnapshot(SLOT_SURFACE) });

        expect(heard).toEqual([SLOT_SURFACE, "narraleaf-studio:main-surface"]);
    });

    it("names the stack a component tab claims", () => {
        expect(uiEditorHistoryScope(SLOT_SURFACE)).toBe(uiComponentHistoryScope("slot"));
        expect(uiEditorHistoryScope("surface-a")).toBe(uiSurfaceHistoryScope("surface-a"));
    });
});

/**
 * A list's fields live in the document's library, not on the list. A page's undo has to carry the
 * shapes its lists name, or renaming a field is a change no step records and changing a list's shape
 * cannot be taken back without leaving it pointing at a shape the library has dropped.
 */
describe("UIEditorHistoryService and the shapes a page's lists name", () => {
    function withList(structs: UIDocument["structs"], itemStructId: string): UIDocument {
        const document = documentWithPositions(0, 0);
        document.elements["root-a"] = { ...document.elements["root-a"]!, childrenIds: ["a", "list"] };
        document.elements.list = {
            id: "list",
            type: "nl.list",
            name: "list",
            parentId: "root-a",
            childrenIds: [],
            layout: { x: 0, y: 0, width: 100, height: 100, visible: true, opacity: 1 },
            props: { itemStructId },
        };
        document.structs = structs;
        return document;
    }
    const OWN = { id: "own", fields: [{ id: "f1", key: "name", type: "string" as const }] };

    it("records a renamed field as a step, and undo puts the old name back", () => {
        const { history, uidoc } = createHarness(withList({ own: OWN }, "own"));
        const before = history.captureSnapshot("surface-a");
        uidoc.document = withList({ own: { id: "own", fields: [{ id: "f1", key: "title", type: "string" }] } }, "own");
        history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });

        expect(history.canUndo("surface-a")).toBe(true);
        history.undo("surface-a");
        expect(uidoc.document.structs?.own?.fields[0]?.key).toBe("name");
    });

    it("puts back the shape a list had before it took one of the engine's", () => {
        const { history, uidoc } = createHarness(withList({ own: OWN }, "own"));
        const before = history.captureSnapshot("surface-a");
        uidoc.document = withList({}, "nl.ending");
        history.record({ surfaceId: "surface-a", before, after: history.captureSnapshot("surface-a") });

        history.undo("surface-a");
        expect((uidoc.document.elements.list!.props as Record<string, unknown>).itemStructId).toBe("own");
        expect(uidoc.document.structs?.own).toEqual(OWN);

        history.redo("surface-a");
        expect((uidoc.document.elements.list!.props as Record<string, unknown>).itemStructId).toBe("nl.ending");
        expect(uidoc.document.structs?.own).toBeUndefined();
    });
});
