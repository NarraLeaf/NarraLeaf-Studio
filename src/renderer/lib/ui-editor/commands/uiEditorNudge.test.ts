import { afterEach, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
} from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { Services } from "@/lib/workspace/services/services";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { DEFAULT_MERGE_WINDOW_MS } from "@/lib/workspace/services/history/historyModel";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import {
    UI_EDITOR_NUDGE_LARGE_STEP,
    UI_EDITOR_NUDGE_STEP,
    computeUiEditorNudgePatches,
    uiEditorNudge,
    uiEditorNudgeMergeKey,
} from "./uiEditorNudge";

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
 * root(800x600)
 *   a  (10,10,100,50)
 *   b  (200,80,60,40)
 *   panel (300,400,200,100)
 *     inner (20,10,40,20)
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
                designSize: { width: 800, height: 600 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: element("root", "nl.root", null, { x: 0, y: 0, width: 800, height: 600 }, ["a", "b", "panel"]),
            a: element("a", "nl.text", "root", { x: 10, y: 10, width: 100, height: 50 }),
            b: element("b", "nl.text", "root", { x: 200, y: 80, width: 60, height: 40 }),
            panel: element("panel", "nl.container", "root", { x: 300, y: 400, width: 200, height: 100 }, ["inner"]),
            inner: element("inner", "nl.text", "panel", { x: 20, y: 10, width: 40, height: 20 }),
        },
        meta: {},
    };
}

function selection(ids: string[], surfaceId = "surface"): UIElementSelection {
    return { editor: "ui", surfaceId, elementIds: ids, primaryId: ids[ids.length - 1] };
}

describe("UI editor nudge, deltas", () => {
    it("moves by the step on one axis and leaves the other unwritten", () => {
        const doc = makeDocument();
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a"]), UI_EDITOR_NUDGE_STEP, 0)).toEqual({
            a: { x: 11 },
        });
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a"]), 0, -UI_EDITOR_NUDGE_STEP)).toEqual({
            a: { y: 9 },
        });
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a"]), 0, UI_EDITOR_NUDGE_LARGE_STEP)).toEqual({
            a: { y: 20 },
        });
    });

    it("keeps a fractional position fractional", () => {
        const doc = makeDocument();
        doc.elements.a.layout.x = 10.25;
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a"]), -UI_EDITOR_NUDGE_STEP, 0)).toEqual({
            a: { x: 9.25 },
        });
    });

    it("moves a box with a negative extent by the same delta", () => {
        // The stored x is the anchor whichever way the box extends, so the whole box moves by dx.
        const doc = makeDocument();
        doc.elements.a.layout = { x: 110, y: 10, width: -100, height: 50 };
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a"]), UI_EDITOR_NUDGE_LARGE_STEP, 0)).toEqual({
            a: { x: 120 },
        });
    });

    it("moves every selected element, across containers", () => {
        const doc = makeDocument();
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a", "inner"]), 0, UI_EDITOR_NUDGE_STEP)).toEqual({
            a: { y: 11 },
            inner: { y: 11 },
        });
    });

    it("does nothing for a zero delta", () => {
        expect(computeUiEditorNudgePatches(makeDocument(), "surface", selection(["a"]), 0, 0)).toEqual({});
    });
});

describe("UI editor nudge, excluded elements", () => {
    it("skips a flow-layout child, whose x and y are zeroed on every write", () => {
        const doc = makeDocument();
        doc.elements.panel.props = { layoutKind: "stack" };
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["inner"]), 1, 0)).toEqual({});
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a", "inner"]), 1, 0)).toEqual({ a: { x: 11 } });
    });

    it("skips slider and switch parts", () => {
        const doc = makeDocument();
        doc.elements.panel = element("panel", "nl.slider", "root", { x: 300, y: 400, width: 200, height: 100 }, ["inner"]);
        doc.elements.inner = element("inner", "nl.container", "panel", { x: 20, y: 10, width: 40, height: 20 }, [], {
            sliderSlot: "handle",
        });
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["inner"]), 1, 0)).toEqual({});

        doc.elements.panel = element("panel", "nl.switch", "root", { x: 300, y: 400, width: 52, height: 28 }, ["inner"]);
        doc.elements.inner = element("inner", "nl.container", "panel", { x: 3, y: 3, width: 22, height: 22 }, [], {
            switchSlot: "thumb",
        });
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["inner"]), 1, 0)).toEqual({});
    });

    it("skips the surface root", () => {
        expect(computeUiEditorNudgePatches(makeDocument(), "surface", selection(["root"]), 1, 0)).toEqual({});
    });

    it("moves a selected container once and lets a selected child ride along", () => {
        expect(computeUiEditorNudgePatches(makeDocument(), "surface", selection(["panel", "inner"]), 1, 0)).toEqual({
            panel: { x: 301 },
        });
    });

    it("ignores a selection on another surface and a null selection", () => {
        const doc = makeDocument();
        expect(computeUiEditorNudgePatches(doc, "surface", selection(["a"], "other"), 1, 0)).toEqual({});
        expect(computeUiEditorNudgePatches(doc, "surface", null, 1, 0)).toEqual({});
    });
});

describe("uiEditorNudge write path", () => {
    function harness(doc: UIDocument) {
        const updateElementLayouts = vi.fn();
        const documentService = {
            getDocument: () => doc,
            updateElementLayouts,
        } as unknown as UIDocumentService;
        return { documentService, updateElementLayouts };
    }

    it("writes every moved element in one call, keyed by the elements", () => {
        const { documentService, updateElementLayouts } = harness(makeDocument());

        expect(uiEditorNudge(documentService, "surface", selection(["b", "a"]), 1, 0)).toBe(true);

        expect(updateElementLayouts).toHaveBeenCalledTimes(1);
        expect(updateElementLayouts).toHaveBeenCalledWith(
            { a: { x: 11 }, b: { x: 201 } },
            { mergeKey: uiEditorNudgeMergeKey("surface", ["a", "b"]) },
        );
    });

    it("writes nothing when nothing selected can move", () => {
        const doc = makeDocument();
        doc.elements.panel.props = { layoutKind: "stack" };
        const { documentService, updateElementLayouts } = harness(doc);

        expect(uiEditorNudge(documentService, "surface", selection(["inner"]), 1, 0)).toBe(false);
        expect(uiEditorNudge(documentService, "surface", selection(["root"]), 0, 1)).toBe(false);
        expect(uiEditorNudge(documentService, "surface", null, 0, 1)).toBe(false);
        expect(updateElementLayouts).not.toHaveBeenCalled();
    });

    it("keys a run by the elements, not by their order or the direction", () => {
        expect(uiEditorNudgeMergeKey("surface", ["b", "a"])).toBe(uiEditorNudgeMergeKey("surface", ["a", "b"]));
        expect(uiEditorNudgeMergeKey("surface", ["a"])).not.toBe(uiEditorNudgeMergeKey("surface", ["a", "b"]));
    });
});

/**
 * The real document service, editor history and history stacks, so "one undo step" is measured on
 * the stack Ctrl+Z pops rather than on what the command asked for.
 */
describe("uiEditorNudge undo steps", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

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
        const x = (id: string) => document.getDocument().elements[id].layout.x;
        const y = (id: string) => document.getDocument().elements[id].layout.y;
        return { document, editorHistory, x, y };
    }

    it("folds a fast run of presses into one step that one undo takes back", () => {
        vi.useFakeTimers({ now: 1_000_000 });
        const { document, editorHistory, x, y } = services(makeDocument());
        const sel = selection(["a"]);

        uiEditorNudge(document, "surface", sel, 1, 0);
        vi.setSystemTime(Date.now() + 60);
        uiEditorNudge(document, "surface", sel, 1, 0);
        vi.setSystemTime(Date.now() + 60);
        uiEditorNudge(document, "surface", sel, 0, 10);
        expect([x("a"), y("a")]).toEqual([12, 20]);

        expect(editorHistory.undo("surface")).toBe(true);
        expect([x("a"), y("a")]).toEqual([10, 10]);
        expect(editorHistory.canUndo("surface")).toBe(false);
    });

    it("keeps a held key's auto-repeat to one step however long it runs", () => {
        // Each repeat lands well inside the window of the one before, so the step keeps extending.
        vi.useFakeTimers({ now: 1_000_000 });
        const { document, editorHistory, x } = services(makeDocument());
        const sel = selection(["a"]);
        for (let press = 0; press < 40; press++) {
            uiEditorNudge(document, "surface", sel, 1, 0);
            vi.setSystemTime(Date.now() + 33);
        }
        expect(x("a")).toBe(50);
        expect(editorHistory.undo("surface")).toBe(true);
        expect(x("a")).toBe(10);
        expect(editorHistory.canUndo("surface")).toBe(false);
    });

    it("starts a new step after a pause longer than the merge window", () => {
        vi.useFakeTimers({ now: 1_000_000 });
        const { document, editorHistory, x } = services(makeDocument());
        const sel = selection(["a"]);

        uiEditorNudge(document, "surface", sel, 1, 0);
        vi.setSystemTime(Date.now() + DEFAULT_MERGE_WINDOW_MS + 1);
        uiEditorNudge(document, "surface", sel, 1, 0);
        expect(x("a")).toBe(12);

        expect(editorHistory.undo("surface")).toBe(true);
        expect(x("a")).toBe(11);
        expect(editorHistory.undo("surface")).toBe(true);
        expect(x("a")).toBe(10);
    });

    it("starts a new step when the selection changes", () => {
        vi.useFakeTimers({ now: 1_000_000 });
        const { document, editorHistory, x } = services(makeDocument());

        uiEditorNudge(document, "surface", selection(["a"]), 1, 0);
        vi.setSystemTime(Date.now() + 60);
        uiEditorNudge(document, "surface", selection(["b"]), 1, 0);

        expect(editorHistory.undo("surface")).toBe(true);
        expect([x("a"), x("b")]).toEqual([11, 200]);
    });

    it("leaves no step behind when nothing moved", () => {
        const initial = makeDocument();
        initial.elements.panel.props = { layoutKind: "stack" };
        const { document, editorHistory } = services(initial);

        expect(uiEditorNudge(document, "surface", selection(["inner"]), 1, 0)).toBe(false);
        expect(editorHistory.canUndo("surface")).toBe(false);
        expect(document.isDirty()).toBe(false);
    });
});
