import { describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { Services } from "@/lib/workspace/services/services";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { COMPONENT_EDITOR_VIRTUAL_ROOT_PREFIX } from "@/lib/ui-editor/componentEditorRoot";
import { computeUiEditorSnapToGridPatches, uiEditorSnapSelectionToGrid } from "./uiEditorGridSnap";

type Box = { x: number; y: number; width: number; height: number };

function element(
    id: string,
    type: string,
    parentId: string | null,
    layout: Box,
    childrenIds: string[] = [],
    extra?: Record<string, unknown>,
): UIElement {
    return { id, type, name: id, parentId, childrenIds, layout, extra };
}

/**
 * root(1920x1080)
 *   a     (13,27,100,50)
 *   b     (209,91,60,40)
 *   ok    (40,60,10,10)      - already on the grid
 *   panel (305,407,400,300)  - an offset container, off the grid
 *     inner (20,10,40,20)    - at (325,417) on the surface
 */
function makeDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1920, height: 1080 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: element("root", "nl.root", null, { x: 0, y: 0, width: 1920, height: 1080 }, ["a", "b", "ok", "panel"]),
            a: element("a", "nl.text", "root", { x: 13, y: 27, width: 100, height: 50 }),
            b: element("b", "nl.text", "root", { x: 209, y: 91, width: 60, height: 40 }),
            ok: element("ok", "nl.text", "root", { x: 40, y: 60, width: 10, height: 10 }),
            panel: element("panel", "nl.container", "root", { x: 305, y: 407, width: 400, height: 300 }, ["inner"]),
            inner: element("inner", "nl.text", "panel", { x: 20, y: 10, width: 40, height: 20 }),
        },
        meta: {},
    };
}

function selection(ids: string[], surfaceId = "surface"): UIElementSelection {
    return { editor: "ui", surfaceId, elementIds: ids, primaryId: ids[ids.length - 1] };
}

describe("snap to grid, positions", () => {
    it("moves each selected element's top-left corner to its own nearest grid point", () => {
        expect(computeUiEditorSnapToGridPatches(makeDocument(), "surface", selection(["a", "b"]), 20)).toEqual({
            a: { x: 20, y: 20 },
            b: { x: 200, y: 100 },
        });
    });

    it("uses the spacing it is given", () => {
        expect(computeUiEditorSnapToGridPatches(makeDocument(), "surface", selection(["b"]), 50)).toEqual({
            b: { x: 200, y: 100 },
        });
        expect(computeUiEditorSnapToGridPatches(makeDocument(), "surface", selection(["a"]), 8)).toEqual({
            a: { x: 16, y: 24 },
        });
    });

    it("snaps negative and fractional positions", () => {
        const doc = makeDocument();
        doc.elements.a.layout = { x: -13, y: -7.5, width: 100, height: 50 };
        doc.elements.b.layout = { x: 10.01, y: 29.99, width: 60, height: 40 };
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["a", "b"]), 20)).toEqual({
            a: { x: -20, y: 0 },
            b: { x: 20, y: 20 },
        });
    });

    it("puts a child of an offset container on the screen's grid points, in its parent's coordinates", () => {
        const doc = makeDocument();
        const patches = computeUiEditorSnapToGridPatches(doc, "surface", selection(["inner"]), 20);
        // On the surface (325, 417) goes to (320, 420); inside the panel at (305, 407) that is (15, 13).
        expect(patches).toEqual({ inner: { x: 15, y: 13 } });
        doc.elements.inner.layout = { ...doc.elements.inner.layout, ...patches.inner };
        expect(getElementSurfaceTopLeft(doc, "inner")).toEqual({ x: 320, y: 420 });
    });

    it("keeps a negative position inside the parent rather than clamping it to 0", () => {
        const doc = makeDocument();
        doc.elements.inner.layout = { x: -3, y: -4, width: 40, height: 20 };
        // (302, 403) on the surface goes to (300, 400): (-5, -7) inside the panel.
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["inner"]), 20)).toEqual({
            inner: { x: -5, y: -7 },
        });
    });

    it("snaps a box with a negative extent by its visual corner and writes back its anchor", () => {
        const doc = makeDocument();
        // Extends left from x=110, so its visual left edge is 10, which goes to 20.
        doc.elements.a.layout = { x: 110, y: 27, width: -100, height: 50 };
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["a"]), 20)).toEqual({
            a: { x: 120, y: 20 },
        });
    });

    it("writes only the axis that changes, and nothing for an element already on the grid", () => {
        const doc = makeDocument();
        doc.elements.a.layout = { x: 40, y: 27, width: 100, height: 50 };
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["a", "ok"]), 20)).toEqual({
            a: { y: 20 },
        });
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["ok"]), 20)).toEqual({});
    });

    it("measures from the component's top-left corner in the component editor", () => {
        // The component editor draws a definition under a made-up root, with the component's own root
        // at the origin. Its children snap to the grid that starts at the component's corner.
        const virtualRoot = `${COMPONENT_EDITOR_VIRTUAL_ROOT_PREFIX}card`;
        const doc: UIDocument = {
            ...makeDocument(),
            surfaces: [
                {
                    id: "component-surface",
                    name: "Card",
                    host: "app",
                    kind: "appSurface",
                    designSize: { width: 300, height: 200 },
                    rootElementId: virtualRoot,
                },
            ],
            elements: {
                [virtualRoot]: element(virtualRoot, "nl.root", null, { x: 0, y: 0, width: 300, height: 200 }, ["card"]),
                card: element("card", "nl.container", virtualRoot, { x: 0, y: 0, width: 300, height: 200 }, ["label"]),
                label: element("label", "nl.text", "card", { x: 13, y: 33, width: 100, height: 20 }),
            },
        };
        expect(computeUiEditorSnapToGridPatches(doc, "component-surface", selection(["label", "card"], "component-surface"), 20)).toEqual({
            label: { x: 20, y: 40 },
        });
    });
});

describe("snap to grid, excluded elements", () => {
    it("skips a stack or list child, whose position its parent decides", () => {
        const doc = makeDocument();
        doc.elements.panel.props = { layoutKind: "stack" };
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["inner"]), 20)).toEqual({});
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["a", "inner"]), 20)).toEqual({
            a: { x: 20, y: 20 },
        });
    });

    it("skips slider and switch parts", () => {
        const doc = makeDocument();
        doc.elements.panel = element("panel", "nl.slider", "root", { x: 305, y: 407, width: 200, height: 100 }, ["inner"]);
        doc.elements.inner = element("inner", "nl.container", "panel", { x: 20, y: 10, width: 40, height: 20 }, [], {
            sliderSlot: "handle",
        });
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["inner"]), 20)).toEqual({});
    });

    it("skips the surface root", () => {
        expect(computeUiEditorSnapToGridPatches(makeDocument(), "surface", selection(["root"]), 20)).toEqual({});
    });

    it("snaps a selected container once and lets a selected child ride along", () => {
        expect(computeUiEditorSnapToGridPatches(makeDocument(), "surface", selection(["panel", "inner"]), 20)).toEqual({
            panel: { x: 300, y: 400 },
        });
    });

    it("ignores a selection on another surface, a null selection and a spacing that is not one", () => {
        const doc = makeDocument();
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["a"], "other"), 20)).toEqual({});
        expect(computeUiEditorSnapToGridPatches(doc, "surface", null, 20)).toEqual({});
        expect(computeUiEditorSnapToGridPatches(doc, "surface", selection(["a"]), 0)).toEqual({});
    });
});

describe("uiEditorSnapSelectionToGrid write path", () => {
    function harness(doc: UIDocument) {
        const updateElementLayouts = vi.fn();
        const documentService = {
            getDocument: () => doc,
            updateElementLayouts,
        } as unknown as UIDocumentService;
        return { documentService, updateElementLayouts };
    }

    it("writes every moved element in one call", () => {
        const { documentService, updateElementLayouts } = harness(makeDocument());
        expect(uiEditorSnapSelectionToGrid(documentService, "surface", selection(["b", "a"]), 20)).toBe(true);
        expect(updateElementLayouts).toHaveBeenCalledTimes(1);
        expect(updateElementLayouts).toHaveBeenCalledWith({ a: { x: 20, y: 20 }, b: { x: 200, y: 100 } });
    });

    it("writes nothing when nothing would move", () => {
        const doc = makeDocument();
        doc.elements.panel.props = { layoutKind: "stack" };
        const { documentService, updateElementLayouts } = harness(doc);
        expect(uiEditorSnapSelectionToGrid(documentService, "surface", selection(["inner"]), 20)).toBe(false);
        expect(uiEditorSnapSelectionToGrid(documentService, "surface", selection(["ok"]), 20)).toBe(false);
        expect(uiEditorSnapSelectionToGrid(documentService, "surface", selection(["root"]), 20)).toBe(false);
        expect(uiEditorSnapSelectionToGrid(documentService, "surface", null, 20)).toBe(false);
        expect(updateElementLayouts).not.toHaveBeenCalled();
    });
});

/**
 * The real document service, editor history and history stacks, so "one undo step" is measured on
 * the stack Ctrl+Z pops rather than on what the command asked for.
 */
describe("uiEditorSnapSelectionToGrid undo steps", () => {
    function services(initial: UIDocument) {
        const document = new UIDocumentService();
        const editorHistory = new UIEditorHistoryService();
        const history = new HistoryService();
        const graphDocument = {
            blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {} },
        };
        const context = {
            project: {} as never,
            services: {
                get(id: Services) {
                    switch (id) {
                        case Services.UIDocument:
                            return document;
                        case Services.UIEditorHistory:
                            return editorHistory;
                        case Services.History:
                            return history;
                        case Services.UIGraph:
                            return {
                                getDocument: () => graphDocument,
                                applyGraphMutation: (mutate: (doc: typeof graphDocument) => void) => mutate(graphDocument),
                            };
                        case Services.UIBlueprintLifecycle:
                            return { syncFromUidoc: () => undefined };
                        default:
                            throw new Error(`Unexpected service ${id}`);
                    }
                },
            } as never,
            commandLineRun: false,
        };
        document.setContext(context);
        editorHistory.setContext(context);
        history.setContext(context);
        (document as unknown as { document: UIDocument }).document = initial;
        const at = (id: string) => {
            const layout = document.getDocument().elements[id].layout;
            return [layout.x, layout.y];
        };
        return { document, editorHistory, at };
    }

    it("moves two elements in one step that one undo takes back", () => {
        const { document, editorHistory, at } = services(makeDocument());

        expect(uiEditorSnapSelectionToGrid(document, "surface", selection(["a", "inner"]), 20)).toBe(true);
        expect([at("a"), at("inner")]).toEqual([[20, 20], [15, 13]]);

        expect(editorHistory.undo("surface")).toBe(true);
        expect([at("a"), at("inner")]).toEqual([[13, 27], [20, 10]]);
        expect(editorHistory.canUndo("surface")).toBe(false);
    });

    it("leaves no step behind when nothing moved", () => {
        const initial = makeDocument();
        initial.elements.panel.props = { layoutKind: "stack" };
        const { document, editorHistory } = services(initial);

        expect(uiEditorSnapSelectionToGrid(document, "surface", selection(["inner"]), 20)).toBe(false);
        expect(uiEditorSnapSelectionToGrid(document, "surface", selection(["ok"]), 20)).toBe(false);
        expect(editorHistory.canUndo("surface")).toBe(false);
        expect(document.isDirty()).toBe(false);
    });
});
