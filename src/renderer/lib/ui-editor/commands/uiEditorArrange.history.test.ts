import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { Services } from "@/lib/workspace/services/services";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { createOutlinePanelMenuActions } from "../interaction/outline/outlinePanelContextActions";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { uiEditorArrange, type UiEditorArrangeOp } from "./uiEditorArrange";

function element(id: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return { id, type: id === "root" ? "nl.root" : "nl.container", parentId, childrenIds, layout: { x: 0, y: 0, width: 100, height: 100 } };
}

function services() {
    const initial: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION, id: "doc", name: "Doc", meta: {},
        surfaces: [{ id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 800, height: 600 }, rootElementId: "root" }],
        elements: {
            root: element("root", null, ["p1", "p2"]),
            p1: element("p1", "root", ["a", "a-next"]), p2: element("p2", "root", ["b", "b-next"]),
            a: element("a", "p1"), "a-next": element("a-next", "p1"),
            b: element("b", "p2"), "b-next": element("b-next", "p2"),
        },
    };
    const document = new UIDocumentService();
    const editorHistory = new UIEditorHistoryService();
    const history = new HistoryService();
    const graphDocument = { blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {} } };
    const context = {
        project: {} as never,
        services: { get(id: Services) {
            switch (id) {
                case Services.UIDocument: return document;
                case Services.UIEditorHistory: return editorHistory;
                case Services.History: return history;
                case Services.UIGraph: return {
                    getDocument: () => graphDocument,
                    applyGraphMutation: (mutate: (doc: typeof graphDocument) => void) => mutate(graphDocument),
                };
                case Services.UIBlueprintLifecycle: return { syncFromUidoc: () => undefined };
                default: throw new Error(`Unexpected service ${id}`);
            }
        } } as never,
        commandLineRun: false,
    };
    document.setContext(context);
    editorHistory.setContext(context);
    history.setContext(context);
    (document as unknown as { document: UIDocument }).document = initial;
    return { document, editorHistory };
}

describe("arranging a selection in multiple containers", () => {
    it.each<UiEditorArrangeOp>(["bringForward", "bringToFront"])("undoes one %s gesture in one step", op => {
        const { document, editorHistory } = services();
        const selected = { editor: "ui" as const, surfaceId: "page", elementIds: ["a", "b"], primaryId: "b" };
        expect(uiEditorArrange(document, "page", selected, op)).toBe(true);
        expect(document.getDocument().elements.p1.childrenIds).toEqual(["a-next", "a"]);
        expect(document.getDocument().elements.p2.childrenIds).toEqual(["b-next", "b"]);
        expect(editorHistory.undo("page")).toBe(true);
        expect(document.getDocument().elements.p1.childrenIds).toEqual(["a", "a-next"]);
        expect(document.getDocument().elements.p2.childrenIds).toEqual(["b", "b-next"]);
        expect(editorHistory.canUndo("page")).toBe(false);
    });

    it("keeps the component editor's multi-container arrangement on its own undo stack", () => {
        const { document, editorHistory } = services();
        document.getDocument().components = [{
            id: "card", name: "Card", rootElementId: "card-root", updatedAt: "2026-01-01T00:00:00.000Z",
            elements: {
                "card-root": element("card-root", null, ["left", "right"]),
                left: element("left", "card-root", ["a1", "a2"]), right: element("right", "card-root", ["b1", "b2"]),
                a1: element("a1", "left"), a2: element("a2", "left"),
                b1: element("b1", "right"), b2: element("b2", "right"),
            },
        }];
        const component = createComponentDocumentServiceAdapter(document, "card");
        const surfaceId = getComponentEditorSurfaceId("card");
        const selected = { editor: "ui" as const, surfaceId, elementIds: ["a1", "b1"], primaryId: "b1" };
        expect(uiEditorArrange(component, surfaceId, selected, "bringForward")).toBe(true);
        expect(component.getDocument().elements.left.childrenIds).toEqual(["a2", "a1"]);
        expect(component.getDocument().elements.right.childrenIds).toEqual(["b2", "b1"]);
        expect(editorHistory.undo(surfaceId)).toBe(true);
        expect(component.getDocument().elements.left.childrenIds).toEqual(["a1", "a2"]);
        expect(component.getDocument().elements.right.childrenIds).toEqual(["b1", "b2"]);
        expect(editorHistory.canUndo(surfaceId)).toBe(false);
    });

    it("records no undo step when every selected element is already at the front", () => {
        const { document, editorHistory } = services();
        const selected = { editor: "ui" as const, surfaceId: "page", elementIds: ["a-next", "b-next"], primaryId: "b-next" };
        expect(uiEditorArrange(document, "page", selected, "bringToFront")).toBe(false);
        expect(editorHistory.canUndo("page")).toBe(false);
    });
});

describe("changing selected layers' visibility", () => {
    it("undoes one outline action in one step", () => {
        const { document, editorHistory } = services();
        const menuSel = { editor: "ui" as const, surfaceId: "page", elementIds: ["a", "b"], primaryId: "b" };
        const actions = createOutlinePanelMenuActions({
            documentService: document,
            stateService: {} as UIEditorStateService,
            localBlueprint: {} as LocalBlueprintService,
            surfaceId: "page", hideMenu: () => {}, inputDialog: null, menuSel,
            doc: document.getDocument(), effectiveRootId: "root",
            collectBranchIdsWithChildren: () => [], insertChildInOutline: () => {}, pasteHitElementId: null,
            pickRenamePrimaryId: () => undefined, canRenamePrimary: () => false,
        });
        actions.setSelectedVisible(false);
        expect(document.getDocument().elements.a.layout.visible).toBe(false);
        expect(document.getDocument().elements.b.layout.visible).toBe(false);
        expect(editorHistory.undo("page")).toBe(true);
        expect(document.getDocument().elements.a.layout.visible).not.toBe(false);
        expect(document.getDocument().elements.b.layout.visible).not.toBe(false);
        expect(editorHistory.canUndo("page")).toBe(false);
    });
});
