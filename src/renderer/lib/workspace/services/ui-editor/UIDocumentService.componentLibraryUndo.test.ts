/**
 * Undo for the component library's own operations - creating, copying, deleting and importing
 * definitions - which the rail makes and the project's stack takes back.
 *
 * None of them left a step. Deleting a definition asked for confirmation and was then final: its
 * record, its widgets' blueprints and the item shapes its lists named were gone, while every
 * placement on a page drew as missing - and the project check told the author to undo the deletion.
 * These pin each operation to one step, that undo puts the library back exactly (place in the order,
 * blueprints, shapes) without touching anything else, that redo repeats it, and that a live session
 * drops these steps and leaves the stack's other owners theirs.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { decodeBlueprintOwnerKey, encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UILayout,
} from "@shared/types/ui-editor/document";
import { HistoryService } from "../history/HistoryService";
import { HistoryEntryTag, projectHistoryScope, uiSurfaceHistoryScope } from "../history/historyScopes";
import { translate } from "@/lib/i18n";
import { Services } from "../services";
import { createMainBlueprint } from "./blueprint/blueprintFactories";
import { derivedBlueprintId } from "./blueprint/derivedBlueprintId";
import { componentWidgetMainOwnerKey, widgetMainOwnerKey } from "./blueprint/ownerKeys";
import { setPrivateOwnerBlueprint } from "./blueprint/ownerRecords";
import { IMPORT_PLACEMENT_FROM_SOURCE, UIDocumentService } from "./UIDocumentService";
import { UIEditorHistoryService } from "./UIEditorHistoryService";
import { buildUIComponentEditorSurfaceId, buildUIComponentSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { createBlueprintFnRef } from "./blueprint/fnCatalog";
import { scriptSelfOf } from "@/lib/ui-editor/blueprint-runtime/script/scriptRuntime";

const PAGE = "settings";
const SLOT = "slot";
const BACK = "back";
const BADGE = "badge";
const PROJECT = projectHistoryScope();

function element(
    id: string,
    type: string,
    parentId: string | null,
    childrenIds: string[],
    layout: Partial<UILayout> = {},
    props?: Record<string, unknown>,
): UIElement {
    return {
        id,
        type,
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40, opacity: 1, visible: true, ...layout },
        ...(props ? { props } : {}),
    };
}

function definition(id: string, name: string, elements: UIElement[], extra: Partial<UIComponentDefinition> = {}): UIComponentDefinition {
    return {
        id,
        name,
        rootElementId: elements[0].id,
        elements: Object.fromEntries(elements.map(item => [item.id, item])),
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...extra,
    };
}

/**
 * A settings page that places the back button twice and owns a list of its own, and a library of
 * three definitions with the back button in the middle - its list names a shape nothing else does.
 */
function projectDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: PAGE, name: "Settings", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "pageRoot" },
        ],
        elements: {
            pageRoot: element("pageRoot", "nl.root", null, ["backTop", "backBottom", "pageList"], { width: 1280, height: 720 }),
            backTop: { ...element("backTop", "nl.container", "pageRoot", []), extra: { componentLink: { componentId: BACK, linked: true } } },
            backBottom: { ...element("backBottom", "nl.container", "pageRoot", [], { y: 600 }), extra: { componentLink: { componentId: BACK, linked: true } } },
            pageList: element("pageList", "nl.list", "pageRoot", [], { y: 200 }, { itemStructId: "shape-page" }),
        },
        components: [
            definition(SLOT, "Save slot", [element("slotRoot", "nl.container", null, ["slotNumber"]), element("slotNumber", "nl.text", "slotRoot", [], {}, { text: "01" })]),
            definition(BACK, "Back", [
                element("backRoot", "nl.container", null, ["backLabel", "backList"], { width: 120, height: 48 }),
                element("backLabel", "nl.text", "backRoot", [], { x: 8, y: 8 }, { text: "Back" }),
                element("backList", "nl.list", "backRoot", [], { y: 40 }, { itemStructId: "shape-back", items: [{ label: "one" }] }),
            ], { params: [{ id: "caption", name: "Caption", type: "string", defaultValue: "Back" }] }),
            definition(BADGE, "Badge", [element("badgeRoot", "nl.container", null, [])]),
        ],
        structs: {
            "shape-page": { id: "shape-page", fields: [{ id: "f-title", key: "title", type: "string" }] },
            "shape-back": { id: "shape-back", fields: [{ id: "f-label", key: "label", type: "string" }] },
        },
        meta: {},
    } as UIDocument;
}

/** A blueprint the sweep did not make: named for its logic, where the sweep's own is named for its widget. */
function authoredBlueprint(id: string, componentId: string, elementId: string) {
    return createMainBlueprint({ id, name: `${elementId} logic`, owner: { kind: "componentWidgetMain", componentId, elementId } });
}

/**
 * The services a library operation and its undo pass through, wired as the workspace wires them, with
 * both documents in memory. The lifecycle stand-in does what the real sweep does after every write:
 * collects the private blueprint of a widget that is gone, and gives a widget that has none a fresh,
 * empty one - which is what would replace an authored graph if a record came back before its logic.
 */
function createHarness() {
    let nextId = 0;
    const uidoc = new UIDocumentService();
    const history = new HistoryService();
    const uiHistory = new UIEditorHistoryService();
    const blueprintDocument: BlueprintDocument = {
        schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        blueprints: {},
        ownerRecords: {},
        meta: {},
    };
    const graphDocument = { blueprintDocument };
    const graph = {
        getDocument: () => graphDocument,
        applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument),
    };
    const sweep = () => {
        const bp = graphDocument.blueprintDocument;
        const doc = uidoc.getDocument();
        const components = doc.components ?? [];
        for (const [key, record] of Object.entries(bp.ownerRecords)) {
            const owner = decodeBlueprintOwnerKey(key);
            const gone =
                (owner?.kind === "componentWidgetMain" && !components.find(item => item.id === owner.componentId)?.elements[owner.elementId])
                || (owner?.kind === "widgetMain" && (!doc.elements[owner.elementId] || !doc.surfaces.some(surface => surface.id === owner.surfaceId)));
            if (gone) {
                delete bp.blueprints[record.blueprintId];
                delete bp.ownerRecords[key];
            }
        }
        for (const component of components) {
            for (const elementId of Object.keys(component.elements)) {
                const key = componentWidgetMainOwnerKey(component.id, elementId);
                if (!bp.ownerRecords[key]) {
                    // Under the id derived from the slot, as the real sweep gives it: the id an
                    // authored blueprint the sweep made in the first place already has.
                    const empty = createMainBlueprint({ id: derivedBlueprintId(key), name: elementId, owner: { kind: "componentWidgetMain", componentId: component.id, elementId } });
                    bp.blueprints[empty.id] = empty;
                    setPrivateOwnerBlueprint(bp, key, empty.id);
                }
            }
        }
    };
    const localBlueprint = {
        getBlueprintDocument: () => graphDocument.blueprintDocument,
        applyBlueprintMutation: (mutator: (document: BlueprintDocument) => void) => mutator(graphDocument.blueprintDocument),
        getComponentWidgetMainBlueprintId: (componentId: string, elementId: string) =>
            graphDocument.blueprintDocument.ownerRecords[componentWidgetMainOwnerKey(componentId, elementId)]?.blueprintId,
    };
    const context = {
        project: { resolve: (name: string) => name } as any,
        services: {
            get(serviceId: Services) {
                switch (serviceId) {
                    case Services.Uuid:
                        return { generate: () => `gen-${++nextId}` };
                    case Services.Project:
                        return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                    case Services.UIDocument:
                        return uidoc;
                    case Services.UIEditorHistory:
                        return uiHistory;
                    case Services.History:
                        return history;
                    case Services.UIGraph:
                        return graph;
                    case Services.LocalBlueprint:
                        return localBlueprint;
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

    // The back button's label carries authored logic; every other widget gets the sweep's empty one.
    const logic = authoredBlueprint(derivedBlueprintId(componentWidgetMainOwnerKey(BACK, "backLabel")), BACK, "backLabel");
    graphDocument.blueprintDocument.blueprints[logic.id] = logic;
    setPrivateOwnerBlueprint(graphDocument.blueprintDocument, componentWidgetMainOwnerKey(BACK, "backLabel"), logic.id);
    sweep();

    const library = () => (uidoc.getDocument().components ?? []).map(component => component.name);
    const component = (id: string): UIComponentDefinition | undefined =>
        structuredClone((uidoc.getDocument().components ?? []).find(item => item.id === id));
    /** One definition's slice of the blueprint document: its owner records and their blueprints. */
    const blueprintsOf = (componentId: string) => {
        const bp = graphDocument.blueprintDocument;
        const out: Record<string, unknown> = {};
        for (const [key, record] of Object.entries(bp.ownerRecords)) {
            const owner = decodeBlueprintOwnerKey(key);
            if (owner?.kind === "componentWidgetMain" && owner.componentId === componentId) {
                out[key] = structuredClone(bp.blueprints[record.blueprintId]);
            }
        }
        return out;
    };
    const steps = () => history.describe().find(stack => stack.scopeId === PROJECT) ?? { undo: 0, redo: 0 };
    return { uidoc, history, uiHistory, graphDocument, library, component, blueprintsOf, steps };
}

describe("deleting a component", () => {
    it("counts placements inside other component definitions as uses", () => {
        const h = createHarness();
        const badge = h.uidoc.getDocument().components!.find(item => item.id === BADGE)!;
        badge.elements.nested = {
            ...element("nested", "nl.container", badge.rootElementId, []),
            extra: { componentLink: { componentId: BACK, linked: true } },
        };
        badge.elements[badge.rootElementId].childrenIds.push("nested");

        expect(h.uidoc.getComponentUsageCount(BACK)).toBe(3);
        expect(h.uidoc.getComponentUsageCount(SLOT)).toBe(0);
    });

    it("is one step, and undo puts it back exactly: its place, its blueprints, its list's shape", () => {
        const h = createHarness();
        const before = h.component(BACK);
        const logicBefore = h.blueprintsOf(BACK);
        const placements = structuredClone([h.uidoc.getDocument().elements.backTop, h.uidoc.getDocument().elements.backBottom]);

        h.uidoc.deleteComponents([BACK]);
        expect(h.library()).toEqual(["Save slot", "Badge"]);
        expect(h.blueprintsOf(BACK)).toEqual({});
        expect(h.steps()).toMatchObject({ undo: 1, redo: 0 });
        expect(h.history.peekUndo(PROJECT)).toEqual({ key: "uiEditor.history.deleteComponent", params: { name: "Back" } });

        // An unrelated edit to the page's own list prunes the shape nothing names any more.
        h.uidoc.setListItemStructFields("pageList", [{ id: "f-title", key: "heading", type: "string" }]);
        expect(h.uidoc.getDocument().structs?.["shape-back"]).toBeUndefined();

        expect(h.history.undo(PROJECT)).toBe(true);
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
        expect(h.component(BACK)).toEqual(before);
        expect(h.blueprintsOf(BACK)).toEqual(logicBefore);
        expect(h.graphDocument.blueprintDocument.blueprints[derivedBlueprintId(componentWidgetMainOwnerKey(BACK, "backLabel"))]?.name)
            .toBe("backLabel logic");
        expect(h.uidoc.getDocument().structs?.["shape-back"]).toEqual({ id: "shape-back", fields: [{ id: "f-label", key: "label", type: "string" }] });
        // The page's own edit stays; the placements were never touched and draw the definition again.
        expect(h.uidoc.getDocument().structs?.["shape-page"]?.fields[0].key).toBe("heading");
        expect([h.uidoc.getDocument().elements.backTop, h.uidoc.getDocument().elements.backBottom]).toEqual(placements);

        expect(h.history.redo(PROJECT)).toBe(true);
        expect(h.library()).toEqual(["Save slot", "Badge"]);
        expect(h.blueprintsOf(BACK)).toEqual({});

        expect(h.history.undo(PROJECT)).toBe(true);
        expect(h.component(BACK)).toEqual(before);
        expect(h.blueprintsOf(BACK)).toEqual(logicBefore);
    });

    it("takes several out in one step and puts each back in its own place", () => {
        const h = createHarness();
        h.uidoc.deleteComponents([SLOT, BADGE]);
        expect(h.library()).toEqual(["Back"]);
        expect(h.steps().undo).toBe(1);
        expect(h.history.peekUndo(PROJECT)).toEqual({ key: "uiEditor.history.deleteComponents", params: { count: 2 } });

        h.history.undo(PROJECT);
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
    });

    it("leaves edits made since to other definitions as they are", () => {
        const h = createHarness();
        h.uidoc.deleteComponents([BACK]);
        h.uidoc.renameComponent(SLOT, "Load slot");
        h.uidoc.updateComponentElementProps(BADGE, "badgeRoot", { opacity: 0.5 });

        h.history.undo(PROJECT);
        expect(h.library()).toEqual(["Load slot", "Back", "Badge"]);
        expect(h.component(BADGE)?.elements.badgeRoot.props).toMatchObject({ opacity: 0.5 });
    });

    it("leaves no step when an operation sink takes the gesture", () => {
        const h = createHarness();
        const handled: unknown[] = [];
        h.uidoc.setOperationSink({ handle: op => { handled.push(op); return true; } });

        h.uidoc.deleteComponents([BACK]);
        // The room applies it, and undo inside a session is the session's.
        expect(handled).toHaveLength(1);
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
        expect(h.history.canUndo(PROJECT)).toBe(false);
    });

    it("records nothing for ids the library does not hold", () => {
        const h = createHarness();
        h.uidoc.deleteComponents(["nope"]);
        expect(h.history.canUndo(PROJECT)).toBe(false);
    });
});

describe("adding to the library", () => {
    it("takes back a new component, and gives back the same one", () => {
        const h = createHarness();
        const created = h.uidoc.createEmptyComponent("Panel");
        expect(h.history.peekUndo(PROJECT)).toEqual({ key: "uiEditor.history.createComponent", params: { name: "Panel" } });
        const made = h.component(created.id);

        h.history.undo(PROJECT);
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
        expect(h.blueprintsOf(created.id)).toEqual({});

        h.history.redo(PROJECT);
        expect(h.library()).toEqual(["Save slot", "Back", "Badge", "Panel"]);
        expect(h.component(created.id)).toEqual(made);
    });

    it("takes back a copied selection in one step, logic and all", () => {
        const h = createHarness();
        const copies = h.uidoc.duplicateComponents([SLOT, BACK]);
        expect(copies).toHaveLength(2);
        expect(h.steps().undo).toBe(1);
        expect(h.history.peekUndo(PROJECT)).toEqual({ key: "uiEditor.history.duplicateComponents", params: { count: 2 } });
        const backCopy = copies[1];
        const copied = h.component(backCopy.id);
        const copiedLogic = h.blueprintsOf(backCopy.id);
        expect(Object.values(copiedLogic).some(blueprint => (blueprint as { name?: string }).name === "backLabel logic")).toBe(true);

        h.history.undo(PROJECT);
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
        expect(h.blueprintsOf(backCopy.id)).toEqual({});

        h.history.redo(PROJECT);
        expect(h.library()).toHaveLength(5);
        expect(h.component(backCopy.id)).toEqual(copied);
        expect(h.blueprintsOf(backCopy.id)).toEqual(copiedLogic);
    });

    it("names a single copy's step after the definition it copied", () => {
        const h = createHarness();
        h.uidoc.duplicateComponent(BACK);
        expect(h.history.peekUndo(PROJECT)).toEqual({ key: "uiEditor.history.duplicateComponent", params: { name: "Back" } });
    });

    it("points a copied component's widget and function references at the copy", () => {
        const h = createHarness();
        const bp = h.graphDocument.blueprintDocument;
        const sourceId = bp.ownerRecords[componentWidgetMainOwnerKey(BACK, "backLabel")].blueprintId;
        bp.blueprints[sourceId].graphs.events.main = { id: "main", graph: { nodes: {
            head: { id: "head", type: "blueprint.fn.head" },
            call: { id: "call", type: "blueprint.fn.call", params: { fnRef: createBlueprintFnRef(sourceId, "head") } },
            ref: { id: "ref", type: "blueprint.element.ref", params: {
                surfaceId: buildUIComponentSurfaceId(BACK), elementId: "backLabel", elementType: "nl.text",
            } },
        }, edges: [] } };

        const copy = h.uidoc.duplicateComponent(BACK)!;
        const label = Object.values(copy.elements).find(item => item.name === "backLabel")!;
        const copyId = bp.ownerRecords[componentWidgetMainOwnerKey(copy.id, label.id)].blueprintId;
        const nodes = bp.blueprints[copyId].graphs.events.main.graph!.nodes!;
        expect(nodes.ref.params).toMatchObject({ surfaceId: buildUIComponentSurfaceId(copy.id), elementId: label.id });
        expect(nodes.call.params?.fnRef).toBe(createBlueprintFnRef(copyId, "head"));
    });

    it("takes back a component made from page elements on the page's stack, without touching the page", () => {
        const h = createHarness();
        const page = structuredClone(h.uidoc.getDocument().elements);
        const made = h.uidoc.createComponentFromElements(PAGE, ["pageList"], "List");
        expect(made).not.toBeNull();
        expect(h.steps()).toMatchObject({ undo: 0 });

        h.history.undo(uiSurfaceHistoryScope(PAGE));
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
        expect(h.uidoc.getDocument().elements).toEqual(page);

        h.history.redo(uiSurfaceHistoryScope(PAGE));
        expect(h.library()).toEqual(["Save slot", "Back", "Badge", "List"]);
    });

    it("preserves linked placements and list field bindings when extracting a component", () => {
        const h = createHarness();
        const document = h.uidoc.getDocument();
        const list = document.elements.pageList;
        list.childrenIds = ["rowText", "rowBack"];
        document.elements.rowText = {
            ...element("rowText", "nl.text", list.id, []),
            extra: { listSlot: "itemTemplate" },
            valueBindings: { text: { kind: "listItemField", fieldId: "f-title" } },
        };
        document.elements.rowBack = {
            ...element("rowBack", "nl.container", list.id, []),
            extra: { listSlot: "itemTemplate", componentLink: { componentId: BACK, linked: true, params: { caption: "Return" } } },
        };

        const made = h.uidoc.createComponentFromElements(PAGE, [list.id], "List")!;
        const text = Object.values(made.elements).find(item => item.name === "rowText")!;
        const back = Object.values(made.elements).find(item => item.name === "rowBack")!;
        expect.soft(text.valueBindings?.text).toEqual({ kind: "listItemField", fieldId: "f-title" });
        expect.soft(back.extra?.componentLink).toEqual({ componentId: BACK, linked: true, params: { caption: "Return" } });
        h.history.undo(uiSurfaceHistoryScope(PAGE));
        h.history.redo(uiSurfaceHistoryScope(PAGE));
        const restored = h.uidoc.getComponent(made.id)!;
        expect(restored.elements[text.id].valueBindings?.text).toEqual({ kind: "listItemField", fieldId: "f-title" });
        expect(restored.elements[back.id].extra?.componentLink).toEqual(back.extra?.componentLink);
    });

    it("keeps a copied slider's track and handle attached to the copied children", () => {
        const h = createHarness();
        const doc = h.uidoc.getDocument();
        const badge = doc.components!.find(item => item.id === BADGE)!;
        const root = badge.elements[badge.rootElementId];
        root.childrenIds.push("slider");
        badge.elements.slider = element("slider", "nl.slider", root.id, ["track", "handle"], {}, { trackElementId: "track", handleElementId: "handle" });
        badge.elements.track = { ...element("track", "nl.container", "slider", []), extra: { sliderSlot: "track" } };
        badge.elements.handle = { ...element("handle", "nl.container", "slider", []), extra: { sliderSlot: "handle" } };

        const copy = h.uidoc.duplicateComponent(BADGE)!;
        const slider = Object.values(copy.elements).find(item => item.name === "slider")!;
        const track = Object.values(copy.elements).find(item => item.name === "track")!;
        const handle = Object.values(copy.elements).find(item => item.name === "handle")!;
        expect(slider.props).toMatchObject({ trackElementId: track.id, handleElementId: handle.id });
        expect(slider.childrenIds).toEqual([track.id, handle.id]);
    });

    it("keeps slider parts attached through extraction, paste into a definition and unlink", () => {
        const h = createHarness();
        const doc = h.uidoc.getDocument();
        const slider = element("slider", "nl.slider", "pageRoot", ["track", "handle"], {}, { trackElementId: "track", handleElementId: "handle" });
        const track = { ...element("track", "nl.container", "slider", []), extra: { sliderSlot: "track" } };
        const handle = { ...element("handle", "nl.container", "slider", []), extra: { sliderSlot: "handle" } };
        Object.assign(doc.elements, { slider, track, handle });
        doc.elements.pageRoot.childrenIds.push(slider.id);

        const extracted = h.uidoc.createComponentFromElements(PAGE, [slider.id], "Slider")!;
        const extractedRoot = extracted.elements[extracted.rootElementId];
        expect(extractedRoot.props?.trackElementId).toBe(extractedRoot.childrenIds[0]);
        expect(extractedRoot.props?.handleElementId).toBe(extractedRoot.childrenIds[1]);

        const payload = {
            v: 1 as const, sourceSurfaceId: PAGE, topLevelElementIds: [slider.id],
            elements: { slider, track, handle }, widgetMainBlueprints: {}, widgetValueBlueprints: {},
        };
        const result = h.uidoc.pasteComponentClipboardPayload(BADGE, "badgeRoot", null, payload);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const pasted = h.uidoc.getComponent(BADGE)!.elements[result.newRootIds[0]];
        expect(pasted.props?.trackElementId).toBe(pasted.childrenIds[0]);
        expect(pasted.props?.handleElementId).toBe(pasted.childrenIds[1]);
        expect(h.uiHistory.undo(buildUIComponentEditorSurfaceId(BADGE))).toBe(true);
        expect(h.uiHistory.redo(buildUIComponentEditorSurfaceId(BADGE))).toBe(true);
        const redone = h.uidoc.getComponent(BADGE)!.elements[pasted.id];
        expect(redone.props?.handleElementId).toBe(redone.childrenIds[1]);

        const placement = h.uidoc.createComponentInstance("pageRoot", extracted.id);
        h.uidoc.unlinkComponentInstance(placement.id);
        const unlinked = h.uidoc.getDocument().elements[placement.id];
        expect(unlinked.props?.trackElementId).toBe(unlinked.childrenIds[0]);
        expect(unlinked.props?.handleElementId).toBe(unlinked.childrenIds[1]);
    });

    it("keeps a text parameter binding when pasting within the same component", () => {
        const h = createHarness();
        const source = {
            ...element("source-text", "nl.text", "badgeRoot", []),
            valueBindings: { text: { kind: "componentParam" as const, paramId: "caption" } },
        };
        const result = h.uidoc.pasteComponentClipboardPayload(BADGE, "badgeRoot", null, {
            v: 1, sourceSurfaceId: buildUIComponentEditorSurfaceId(BADGE), topLevelElementIds: [source.id],
            elements: { [source.id]: source }, widgetMainBlueprints: {}, widgetValueBlueprints: {},
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(h.uidoc.getComponent(BADGE)!.elements[result.newRootIds[0]].valueBindings?.text)
            .toEqual({ kind: "componentParam", paramId: "caption" });
    });

    it("restores materialised component blueprints after undo and redo", () => {
        const h = createHarness();
        const ids = h.uidoc.unlinkComponentInstance("backTop");
        const document = h.uidoc.getDocument();
        const labelId = ids.find(id => document.elements[id]?.name === "backLabel")!;
        const key = widgetMainOwnerKey(PAGE, labelId);
        const blueprints = h.graphDocument.blueprintDocument;
        const copiedId = blueprints.ownerRecords[key]?.blueprintId;
        expect(blueprints.blueprints[copiedId]?.name).toBe("backLabel logic");

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        expect(h.uiHistory.redo(PAGE)).toBe(true);
        const redoneId = blueprints.ownerRecords[key]?.blueprintId;
        expect(blueprints.blueprints[redoneId]?.name).toBe("backLabel logic");
    });

    it("retains a nested root placement when its outer component is unlinked", () => {
        const h = createHarness();
        const outer = h.uidoc.createComponentFromElements(PAGE, ["backTop"], "Outer")!;
        const placed = h.uidoc.createComponentInstance("pageRoot", outer.id);

        h.uidoc.unlinkComponentInstance(placed.id);

        expect(h.uidoc.getDocument().elements[placed.id].extra?.componentLink).toEqual({ componentId: BACK, linked: true });
    });

    it("materialises a placement's text parameter when it is unlinked", () => {
        const h = createHarness();
        const component = h.uidoc.getDocument().components!.find(item => item.id === BADGE)!;
        component.params = [{ id: "caption", name: "Caption", type: "text", defaultValue: "Default" }];
        component.elements.label = {
            ...element("label", "nl.text", component.rootElementId, [], {}, { text: "Sample" }),
            valueBindings: { text: { kind: "componentParam", paramId: "caption" } },
        };
        component.elements[component.rootElementId].childrenIds.push("label");
        const placed = h.uidoc.createComponentInstance("pageRoot", BADGE);
        h.uidoc.setComponentInstanceParam(placed.id, "caption", "Start");

        const ids = h.uidoc.unlinkComponentInstance(placed.id);
        const copied = ids.map(id => h.uidoc.getDocument().elements[id]).find(item => item.name === "label")!;
        expect(copied.props?.text).toBe("Start");
        expect(copied.valueBindings?.text).toBeUndefined();
    });

    it("keeps a text parameter's translation key when unlinking", () => {
        const h = createHarness();
        const component = h.uidoc.getDocument().components!.find(item => item.id === BADGE)!;
        component.params = [{ id: "caption", name: "Caption", type: "text", defaultValue: "Default" }];
        component.elements.label = {
            ...element("label", "nl.text", component.rootElementId, [], {}, { text: "Sample" }),
            valueBindings: { text: { kind: "componentParam", paramId: "caption" } },
        };
        component.elements[component.rootElementId].childrenIds.push("label");
        const placed = h.uidoc.createComponentInstance("pageRoot", BADGE);
        h.uidoc.setComponentInstanceParamKey(placed.id, "caption", "menu.start");

        const ids = h.uidoc.unlinkComponentInstance(placed.id);
        const copied = ids.map(id => h.uidoc.getDocument().elements[id]).find(item => item.name === "label")!;
        expect(copied.props?.localizationKey).toBe("menu.start");
        expect(copied.valueBindings?.text).toBeUndefined();
    });

    it("materialises Get Component Param in the copied blueprint", () => {
        const h = createHarness();
        const bp = h.graphDocument.blueprintDocument;
        const sourceId = bp.ownerRecords[componentWidgetMainOwnerKey(BACK, "backLabel")].blueprintId;
        bp.blueprints[sourceId].graphs.events = {
            main: { id: "main", graph: { nodes: {
                param: { id: "param", type: "blueprint.component.getParam", params: { paramId: "caption" } },
            }, edges: [] } },
        };
        h.uidoc.setComponentInstanceParam("backTop", "caption", "Go back");
        const ids = h.uidoc.unlinkComponentInstance("backTop");
        const labelId = ids.find(id => h.uidoc.getDocument().elements[id]?.name === "backLabel")!;
        const copiedId = bp.ownerRecords[widgetMainOwnerKey(PAGE, labelId)].blueprintId;
        const node = bp.blueprints[copiedId].graphs.events.main.graph!.nodes!.param;
        expect(node).toMatchObject({ id: "param", type: "blueprint.data.stringLiteral", params: { value: "Go back" } });
    });

    it("preserves the script reference when unlinking and resolves the new page owner", () => {
        const h = createHarness();
        const bp = h.graphDocument.blueprintDocument;
        const sourceId = bp.ownerRecords[componentWidgetMainOwnerKey(BACK, "backLabel")].blueprintId;
        bp.blueprints[sourceId].graphs.events = {
            script: { id: "script", script: { scriptRef: "scripts/back.ts" } },
        };
        const ids = h.uidoc.unlinkComponentInstance("backTop");
        const labelId = ids.find(id => h.uidoc.getDocument().elements[id]?.name === "backLabel")!;
        const copiedId = bp.ownerRecords[widgetMainOwnerKey(PAGE, labelId)].blueprintId;
        expect(bp.blueprints[copiedId].graphs.events.script.script?.scriptRef).toBe("scripts/back.ts");
        expect(scriptSelfOf({ surfaceId: PAGE, elementId: labelId, widgetType: "nl.text" })).toMatchObject({ kind: "element" });
        expect(scriptSelfOf({ componentId: BACK, componentParams: { caption: "Return" }, elementId: "backLabel", widgetType: "nl.text" }))
            .toMatchObject({ kind: "componentElement", params: { caption: "Return" } });
    });

    it("preserves the script reference when extracting a page element into a component", () => {
        const h = createHarness();
        const bp = h.graphDocument.blueprintDocument;
        const sourceId = "page-script";
        const source = createMainBlueprint({ id: sourceId, name: "Page script", owner: { kind: "widgetMain", surfaceId: PAGE, elementId: "pageList" } });
        source.graphs.events = { script: { id: "script", script: { scriptRef: "scripts/list.ts" } } };
        bp.blueprints[sourceId] = source;
        setPrivateOwnerBlueprint(bp, widgetMainOwnerKey(PAGE, "pageList"), sourceId);

        const component = h.uidoc.createComponentFromElements(PAGE, ["pageList"], "List")!;
        const copiedId = bp.ownerRecords[componentWidgetMainOwnerKey(component.id, component.rootElementId)].blueprintId;
        expect(bp.blueprints[copiedId].graphs.events.script.script?.scriptRef).toBe("scripts/list.ts");
        expect(scriptSelfOf({ surfaceId: PAGE, elementId: "pageList", widgetType: "nl.list" })).toMatchObject({ kind: "element" });
        expect(scriptSelfOf({ componentId: component.id, elementId: component.rootElementId, widgetType: "nl.list" }))
            .toMatchObject({ kind: "componentElement" });
    });

    it("is the step Ctrl+Z in the page takes back first, ahead of the page's own last edit", () => {
        const h = createHarness();
        h.uidoc.renameElement("pageList", "Moved list");
        h.uidoc.createComponentFromElements(PAGE, ["backTop", "backBottom"]);
        expect(h.library()).toHaveLength(4);

        h.history.undo(uiSurfaceHistoryScope(PAGE));
        expect(h.library()).toEqual(["Save slot", "Back", "Badge"]);
        expect(h.uidoc.getDocument().elements.pageList.name).toBe("Moved list");

        h.history.undo(uiSurfaceHistoryScope(PAGE));
        expect(h.uidoc.getDocument().elements.pageList.name).toBe("pageList");
    });

    it("names a copy of several elements with the catalog's word, and a copy of one after the element", () => {
        const h = createHarness();
        const several = h.uidoc.createComponentFromElements(PAGE, ["backTop", "backBottom"]);
        expect(several?.name).toBe(translate("defaultDoc.componentName"));
        const one = h.uidoc.createComponentFromElements(PAGE, ["pageList"]);
        expect(one?.name).toBe("pageList");
    });
});

/** A template's documents: one page placing one definition, with logic on both. */
function templateBundle() {
    const pageLogic = createMainBlueprint({ id: "tpl-page-bp", name: "Button", owner: { kind: "widgetMain", surfaceId: "tpl-page", elementId: "tpl-button" } });
    const componentLogic = createMainBlueprint({ id: "tpl-chip-bp", name: "Chip", owner: { kind: "componentWidgetMain", componentId: "tpl-chip", elementId: "tpl-chip-root" } });
    return {
        document: {
            schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
            id: "tpl",
            name: "Template",
            surfaces: [{ id: "tpl-page", name: "Gallery", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "tpl-root" }],
            elements: {
                "tpl-root": element("tpl-root", "nl.root", null, ["tpl-button", "tpl-chip-at"], { width: 1280, height: 720 }),
                "tpl-button": element("tpl-button", "nl.container", "tpl-root", []),
                "tpl-chip-at": { ...element("tpl-chip-at", "nl.container", "tpl-root", []), extra: { componentLink: { componentId: "tpl-chip", linked: true } } },
            },
            components: [definition("tpl-chip", "Chip", [element("tpl-chip-root", "nl.container", null, [])])],
            meta: {},
        } as UIDocument,
        graphs: {
            blueprintDocument: {
                schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
                blueprints: { [pageLogic.id]: pageLogic, [componentLogic.id]: componentLogic },
                ownerRecords: {
                    [encodeBlueprintOwnerKey(pageLogic.owner)]: { blueprintId: pageLogic.id },
                    [encodeBlueprintOwnerKey(componentLogic.owner)]: { blueprintId: componentLogic.id },
                },
                meta: {},
            },
        },
    };
}

describe("importing a template or a page", () => {
    it("remaps forward component placements and page targets inside imported definitions", () => {
        const h = createHarness();
        const bundle = templateBundle();
        const nested = {
            ...element("outer-chip", "nl.container", "outer-root", []),
            extra: { componentLink: { componentId: "tpl-chip", linked: true } },
        };
        const frame = element("outer-frame", "nl.frame", "outer-root", [], {}, { targetSurfaceId: "tpl-page" });
        bundle.document.components!.unshift(definition("outer", "Outer", [
            element("outer-root", "nl.container", null, [nested.id, frame.id]), nested, frame,
        ]));

        const result = h.uidoc.importTemplateBundle({ ...bundle, placement: IMPORT_PLACEMENT_FROM_SOURCE });
        const outer = result.importedComponents.find(item => item.name === "Outer")!;
        const chip = result.importedComponents.find(item => item.name === "Chip")!;
        const copiedNested = Object.values(outer.elements).find(item => item.name === "outer-chip")!;
        const copiedFrame = Object.values(outer.elements).find(item => item.name === "outer-frame")!;
        expect.soft(copiedNested.extra?.componentLink).toMatchObject({ componentId: chip.id });
        expect.soft(copiedFrame.props?.targetSurfaceId).toBe(result.importedSurfaces[0].id);

        h.history.undo(PROJECT);
        h.history.redo(PROJECT);
        const restored = h.uidoc.getComponent(outer.id)!;
        expect(restored.elements[copiedNested.id].extra?.componentLink).toMatchObject({ componentId: chip.id });
        expect(restored.elements[copiedFrame.id].props?.targetSurfaceId).toBe(result.importedSurfaces[0].id);
    });

    it("takes back every page and definition it added, with their logic, in one step", () => {
        const h = createHarness();
        const before = structuredClone(h.uidoc.getDocument());
        const bundle = templateBundle();
        const result = h.uidoc.importTemplateBundle({ ...bundle, placement: IMPORT_PLACEMENT_FROM_SOURCE });
        const [page] = result.importedSurfaces;
        const [chip] = result.importedComponents;
        expect(page).toBeDefined();
        expect(chip).toBeDefined();
        expect(h.steps().undo).toBe(1);
        expect(h.history.peekUndo(PROJECT)).toEqual({ key: "uiEditor.history.importSurface", params: { name: "Gallery" } });
        const imported = structuredClone(h.uidoc.getDocument());
        const pageLogicKey = Object.keys(h.graphDocument.blueprintDocument.ownerRecords).find(key => {
            const owner = decodeBlueprintOwnerKey(key);
            return owner?.kind === "widgetMain" && owner.surfaceId === page.id;
        });
        expect(pageLogicKey).toBeDefined();
        const chipLogic = h.blueprintsOf(chip.id);
        expect(Object.keys(chipLogic)).toHaveLength(1);

        h.history.undo(PROJECT);
        expect(h.uidoc.getDocument().surfaces).toEqual(before.surfaces);
        expect(h.uidoc.getDocument().elements).toEqual(before.elements);
        expect(h.uidoc.getDocument().components).toEqual(before.components);
        expect(h.graphDocument.blueprintDocument.ownerRecords[pageLogicKey!]).toBeUndefined();
        expect(h.blueprintsOf(chip.id)).toEqual({});

        h.history.redo(PROJECT);
        expect(h.uidoc.getDocument().surfaces).toEqual(imported.surfaces);
        expect(h.uidoc.getDocument().elements).toEqual(imported.elements);
        expect(h.uidoc.getDocument().components).toEqual(imported.components);
        expect(h.graphDocument.blueprintDocument.ownerRecords[pageLogicKey!]).toBeDefined();
        expect(h.blueprintsOf(chip.id)).toEqual(chipLogic);
    });

    it("leaves no step when its caller's flow goes on past it", () => {
        const h = createHarness();
        h.uidoc.importTemplateBundle({ ...templateBundle(), placement: IMPORT_PLACEMENT_FROM_SOURCE, history: false });
        expect(h.history.canUndo(PROJECT)).toBe(false);
    });
});

describe("a live session", () => {
    it("drops the library's steps and keeps the project stack's other owners", () => {
        const h = createHarness();
        let other = 0;
        h.history.pushCommand(PROJECT, { label: { key: "characters.history.deleteCharacter" as any, params: { name: "Ada" } }, undo: () => { other -= 1; }, redo: () => { other += 1; } });
        h.uidoc.deleteComponents([BACK]);
        h.uidoc.createEmptyComponent("Panel");
        h.history.undo(PROJECT);
        expect(h.steps()).toMatchObject({ undo: 2, redo: 1 });

        h.history.dropTagged(PROJECT, HistoryEntryTag.UILibrary);
        expect(h.steps()).toMatchObject({ undo: 1, redo: 0 });
        expect(h.history.peekUndo(PROJECT)?.key).toBe("characters.history.deleteCharacter");
        h.history.undo(PROJECT);
        expect(other).toBe(-1);
    });
});

describe("the definition's own stack after a deletion is taken back", () => {
    it("still undoes the edits made in the definition before it was deleted", () => {
        const h = createHarness();
        const surfaceId = buildUIComponentEditorSurfaceId(BACK);
        const original = h.component(BACK);
        h.uidoc.renameComponent(BACK, "Return");
        h.uidoc.deleteComponents([BACK]);
        h.history.undo(PROJECT);
        expect(h.component(BACK)?.name).toBe("Return");

        expect(h.uiHistory.undo(surfaceId)).toBe(true);
        expect(h.component(BACK)?.name).toBe(original?.name);
    });
});
