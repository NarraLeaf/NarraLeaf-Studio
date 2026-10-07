/**
 * Changing which element is a component's root, in the definition's own editor.
 *
 * A new component starts as an empty container, and the only way to get a definition whose root is a
 * button - the shape the starter's buttons have - was to make it from one element on a page. Set as
 * Root Element takes the container off a definition that holds one element; Wrap in Container puts one
 * around the root. These pin what each does to the definition, that every placement keeps drawing what
 * it drew, and that one undo in the definition's stack takes back the definition and the placements
 * together.
 */
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { buildUIComponentEditorSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UILayout,
} from "@shared/types/ui-editor/document";
import { HistoryService } from "../history/HistoryService";
import { Services } from "../services";
import { createMainBlueprint } from "./blueprint/blueprintFactories";
import { componentWidgetMainOwnerKey } from "./blueprint/ownerKeys";
import { setPrivateOwnerBlueprint } from "./blueprint/ownerRecords";
import { UIDocumentService } from "./UIDocumentService";
import { UIEditorHistoryService } from "./UIEditorHistoryService";
import { resolveComponentRootPromotionRefusal } from "./componentRootSwap";

const NAV = "nav";
const EDITOR = buildUIComponentEditorSurfaceId(NAV);

function element(id: string, type: string, parentId: string | null, childrenIds: string[], layout: Partial<UILayout> = {}, extra?: UIElement["extra"]): UIElement {
    return {
        id,
        type,
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40, opacity: 1, visible: true, ...layout },
        ...(extra ? { extra } : {}),
    };
}

const placed = { componentLink: { componentId: NAV, linked: true } };

/**
 * A nav bar made the way a new component is: a 300x80 container holding one 120x40 button 100px in
 * and 20px down. Placed twice - freely on a page at twice its size, and in a stack that lays it out.
 */
function projectDocument(): UIDocument {
    const nav: UIComponentDefinition = {
        id: NAV,
        name: "Nav",
        rootElementId: "frame",
        elements: {
            frame: { ...element("frame", "nl.container", null, ["button"], { width: 300, height: 80 }), props: { layoutKind: "free" } },
            button: element("button", "nl.button", "frame", [], { x: 100, y: 20, width: 120, height: 40 }),
        },
        previewMeta: { width: 300, height: 80 },
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "pageRoot" },
        ],
        elements: {
            pageRoot: element("pageRoot", "nl.root", null, ["free", "stack"], { width: 1280, height: 720 }),
            free: element("free", "nl.container", "pageRoot", [], { x: 10, y: 10, width: 600, height: 160 }, placed),
            stack: { ...element("stack", "nl.container", "pageRoot", ["stacked"], { y: 300, width: 800, height: 200 }), props: { layoutKind: "stack" } },
            stacked: element("stacked", "nl.container", "stack", [], { x: 0, y: 0, width: 300, height: 80 }, placed),
        },
        components: [nav],
        meta: {},
    } as UIDocument;
}

/** The document service and its undo, wired as the workspace wires them, with both documents in memory. */
function createHarness() {
    let nextId = 0;
    const uidoc = new UIDocumentService();
    const history = new HistoryService();
    const uiHistory = new UIEditorHistoryService();
    const blueprintDocument: BlueprintDocument = { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {}, meta: {} };
    const graphDocument = { blueprintDocument };
    const graph = {
        getDocument: () => graphDocument,
        applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument),
    };
    // What the real sweep does after a write that matters here: a widget that is gone loses its logic.
    const sweep = () => {
        const components = uidoc.getDocument().components ?? [];
        for (const [key, record] of Object.entries(graphDocument.blueprintDocument.ownerRecords)) {
            const owner = decodeBlueprintOwnerKey(key);
            if (owner?.kind === "componentWidgetMain" && !components.find(item => item.id === owner.componentId)?.elements[owner.elementId]) {
                delete graphDocument.blueprintDocument.blueprints[record.blueprintId];
                delete graphDocument.blueprintDocument.ownerRecords[key];
            }
        }
    };
    const context = {
        project: { resolve: (name: string) => name } as any,
        services: {
            get(serviceId: Services) {
                switch (serviceId) {
                    case Services.Uuid:
                        return { generate: () => `gen-${++nextId}` };
                    case Services.UIDocument:
                        return uidoc;
                    case Services.UIEditorHistory:
                        return uiHistory;
                    case Services.History:
                        return history;
                    case Services.UIGraph:
                        return graph;
                    case Services.UIBlueprintLifecycle:
                        return { syncFromUidoc: sweep };
                    default:
                        throw new Error(`Unexpected service ${serviceId}`);
                }
            },
        } as any,
        commandLineRun: false,
    };
    uidoc.setContext(context);
    history.setContext(context);
    uiHistory.setContext(context);
    (uiHistory as any).init(context);
    (uidoc as any).document = projectDocument();
    (uidoc as any).scheduleAutoSave = () => undefined;
    uidoc.setAfterMutateHook(sweep);

    // The container carries logic of its own, which goes with it.
    const logic = createMainBlueprint({ id: "frame-logic", name: "frame logic", owner: { kind: "componentWidgetMain", componentId: NAV, elementId: "frame" } });
    blueprintDocument.blueprints[logic.id] = logic;
    setPrivateOwnerBlueprint(blueprintDocument, componentWidgetMainOwnerKey(NAV, "frame"), logic.id);

    const nav = () => structuredClone(uidoc.getComponent(NAV)!);
    const box = (id: string) => {
        const { x, y, width, height } = uidoc.getDocument().elements[id]!.layout;
        return { x, y, width, height };
    };
    return { uidoc, uiHistory, graphDocument, nav, box };
}

describe("Set as Root Element", () => {
    it("takes off the container, so the element is the root and the definition is its size", () => {
        const h = createHarness();
        expect(h.uidoc.promoteComponentElementToRoot(NAV, "button")).toBe(true);
        const nav = h.nav();
        expect(nav.rootElementId).toBe("button");
        expect(Object.keys(nav.elements)).toEqual(["button"]);
        expect(nav.elements.button).toMatchObject({ parentId: null, layout: { x: 0, y: 0, width: 120, height: 40 } });
        expect(nav.previewMeta).toEqual({ width: 120, height: 40 });
        expect(h.graphDocument.blueprintDocument.blueprints["frame-logic"]).toBeUndefined();
    });

    it("gives each placement the box the element took up in it, so it draws what it drew", () => {
        const h = createHarness();
        h.uidoc.promoteComponentElementToRoot(NAV, "button");
        // Drawn at twice the definition's size: the button was 200px in and 40px down, at 240x80.
        expect(h.box("free")).toEqual({ x: 210, y: 50, width: 240, height: 80 });
        // Placed by its stack: the stack still decides where, the box is the button's.
        expect(h.box("stacked")).toEqual({ x: 0, y: 0, width: 120, height: 40 });
    });

    it("is one step in the definition's history, which takes back the placements with it", () => {
        const h = createHarness();
        const before = { nav: h.nav(), free: h.box("free"), stacked: h.box("stacked") };
        h.uidoc.promoteComponentElementToRoot(NAV, "button");
        const after = { nav: h.nav(), free: h.box("free"), stacked: h.box("stacked") };

        expect(h.uiHistory.undo(EDITOR)).toBe(true);
        expect({ nav: h.nav(), free: h.box("free"), stacked: h.box("stacked") }).toEqual({ ...before, nav: { ...before.nav, updatedAt: expect.any(String) } });
        expect(h.graphDocument.blueprintDocument.blueprints["frame-logic"]).toBeDefined();

        expect(h.uiHistory.redo(EDITOR)).toBe(true);
        expect({ nav: h.nav(), free: h.box("free"), stacked: h.box("stacked") }).toEqual(after);
    });

    it("refuses an element that shares the root, and changes nothing", () => {
        const h = createHarness();
        const document = (h.uidoc as any).document as UIDocument;
        const frame = document.components![0].elements.frame!;
        frame.childrenIds.push("label");
        document.components![0].elements.label = element("label", "nl.text", "frame", []);
        const before = h.nav();
        expect(h.uidoc.promoteComponentElementToRoot(NAV, "button")).toBe(false);
        expect(h.nav()).toEqual(before);
        expect(h.uiHistory.canUndo(EDITOR)).toBe(false);
    });
});

describe("what can be made the root", () => {
    const nav = () => projectDocument().components![0];

    it("is an element alone in a root container that places its children freely", () => {
        const { elements, rootElementId } = nav();
        expect(resolveComponentRootPromotionRefusal(elements, rootElementId, "button")).toBeNull();
        expect(resolveComponentRootPromotionRefusal(elements, rootElementId, "frame")).toBe("notInRoot");
    });

    it("says why when it is not", () => {
        const stacked = nav();
        stacked.elements.frame!.props = { layoutKind: "stack" };
        expect(resolveComponentRootPromotionRefusal(stacked.elements, "frame", "button")).toBe("rootNotFree");

        const shared = nav();
        shared.elements.frame!.childrenIds.push("label");
        shared.elements.label = element("label", "nl.text", "frame", []);
        expect(resolveComponentRootPromotionRefusal(shared.elements, "frame", "button")).toBe("notAlone");

        const buttonRoot = nav();
        buttonRoot.elements.frame!.type = "nl.button";
        expect(resolveComponentRootPromotionRefusal(buttonRoot.elements, "frame", "button")).toBe("rootNotContainer");
    });
});

describe("Wrap in Container", () => {
    it("puts an empty container of the root's size around it, and no placement changes", () => {
        const h = createHarness();
        h.uidoc.promoteComponentElementToRoot(NAV, "button");
        const placements = { free: h.box("free"), stacked: h.box("stacked") };

        const wrapperId = h.uidoc.wrapComponentRoot(NAV);
        expect(wrapperId).toBeTruthy();
        const nav = h.nav();
        expect(nav.rootElementId).toBe(wrapperId);
        expect(nav.elements[wrapperId!]).toMatchObject({
            type: "nl.container",
            parentId: null,
            childrenIds: ["button"],
            layout: { x: 0, y: 0, width: 120, height: 40 },
            props: { layoutKind: "free", fillVisible: false, strokeVisible: false },
        });
        expect(nav.elements.button).toMatchObject({ parentId: wrapperId, layout: { x: 0, y: 0 } });
        expect({ free: h.box("free"), stacked: h.box("stacked") }).toEqual(placements);

        expect(h.uiHistory.undo(EDITOR)).toBe(true);
        expect(h.nav().rootElementId).toBe("button");
    });
});
