/**
 * Undo in the component editor, end to end: the editor's own document service (the adapter), the
 * real document service behind it, the interface editor's history and the workspace's stacks.
 *
 * Every write a component tab makes used to go into the document with no undo step behind it, so
 * Ctrl+Z in a component tab did nothing at all - a drag, a typed X, a run of nudges, a deleted
 * element. These pin each of those to one step in the definition's own stack, that undo puts the
 * definition back exactly and redo puts the edit back, that the merge window folds what the page
 * editor folds, and that the definition's stack, a second definition's and a page's never reach into
 * one another.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import { decodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIComponentDefinition,
    type UIDocument,
    type UIElement,
    type UILayout,
} from "@shared/types/ui-editor/document";
import type { UIEditorClipboardPayload } from "@/lib/ui-editor/commands/uiEditorClipboard";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { uiComponentHistoryScope, uiSurfaceHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { Services } from "@/lib/workspace/services/services";
import { createMainBlueprint } from "@/lib/workspace/services/ui-editor/blueprint/blueprintFactories";
import { componentWidgetMainOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { setPrivateOwnerBlueprint } from "@/lib/workspace/services/ui-editor/blueprint/ownerRecords";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIEditorHistoryService, uiEditorHistoryScope } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "./componentEditorAdapter";

const PAGE = "page";
const SLOT = "slot";
const BADGE = "badge";
const SLOT_SURFACE = getComponentEditorSurfaceId(SLOT);
const BADGE_SURFACE = getComponentEditorSurfaceId(BADGE);

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

/** A page that places the save slot, the save slot itself, and a second definition beside it. */
function projectDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: PAGE, name: "Save", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "pageRoot" },
        ],
        elements: {
            pageRoot: element("pageRoot", "nl.root", null, ["placed", "pageTitle"], { width: 1280, height: 720 }),
            placed: {
                ...element("placed", "nl.container", "pageRoot", [], { x: 40, y: 40, width: 456, height: 348 }),
                extra: { componentLink: { componentId: SLOT, linked: true } },
            },
            pageTitle: element("pageTitle", "nl.text", "pageRoot", [], { x: 600, y: 20 }, { text: "Save" }),
        },
        components: [
            {
                id: SLOT,
                name: "Save slot",
                rootElementId: "slotRoot",
                params: [{ id: "slot", name: "Slot", type: "string", defaultValue: "1" }],
                previewMeta: { width: 456, height: 348 },
                updatedAt: "2026-01-01T00:00:00.000Z",
                elements: {
                    slotRoot: element("slotRoot", "nl.container", null, ["number", "place", "frame"], { width: 456, height: 348 }),
                    number: element("number", "nl.text", "slotRoot", [], { x: 16, y: 266, width: 60, height: 28 }, { text: "01" }),
                    place: element("place", "nl.text", "slotRoot", [], { x: 76, y: 266, width: 210, height: 28 }, { text: "" }),
                    frame: element("frame", "nl.container", "slotRoot", ["caption"], { x: 1, y: 1, width: 454, height: 255 }),
                    caption: element("caption", "nl.text", "frame", [], { x: 0, y: 0, width: 454, height: 255 }, { text: "Empty" }),
                },
            },
            {
                id: BADGE,
                name: "Badge",
                rootElementId: "badgeRoot",
                updatedAt: "2026-01-01T00:00:00.000Z",
                elements: {
                    badgeRoot: element("badgeRoot", "nl.container", null, ["label"], { width: 120, height: 40 }),
                    label: element("label", "nl.text", "badgeRoot", [], { x: 8, y: 8 }, { text: "New" }),
                },
            },
        ],
        meta: {},
    };
}

/**
 * The services a component tab's writes and undos pass through, wired as the workspace wires them,
 * with the two documents in memory: the blueprint document is checked as the graph service checks
 * it, and every write runs a stand-in for the lifecycle sweep, which drops the private blueprint of a
 * widget that is gone (`UIBlueprintLifecycleCoordinator`).
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
        const components = uidoc.getDocument().components ?? [];
        for (const [key, record] of Object.entries(graphDocument.blueprintDocument.ownerRecords)) {
            const owner = decodeBlueprintOwnerKey(key);
            if (owner?.kind !== "componentWidgetMain") {
                continue;
            }
            const component = components.find(item => item.id === owner.componentId);
            if (!component?.elements[owner.elementId]) {
                delete graphDocument.blueprintDocument.blueprints[record.blueprintId];
                delete graphDocument.blueprintDocument.ownerRecords[key];
            }
        }
    };
    const lifecycle = { syncFromUidoc: sweep };
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
                    case Services.UIBlueprintLifecycle:
                        return lifecycle;
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
    // The history service bridges its stacks to the editor's events in `init`.
    (uiHistory as any).init(context);
    (uidoc as any).document = projectDocument();
    // Nothing here has a disk to write to.
    (uidoc as any).scheduleAutoSave = () => undefined;
    uidoc.setAfterMutateHook(sweep);

    const slot = createComponentDocumentServiceAdapter(uidoc, SLOT);
    const badge = createComponentDocumentServiceAdapter(uidoc, BADGE);
    const definition = (componentId: string): UIComponentDefinition =>
        structuredClone(uidoc.getDocument().components!.find(component => component.id === componentId)!);
    const depth = (scopeId: string) => history.describe().find(stack => stack.scopeId === scopeId) ?? { undo: 0, redo: 0 };
    return { uidoc, history, uiHistory, slot, badge, definition, depth, graphDocument };
}

beforeAll(async () => {
    // Creating an element reads the widget's own defaults.
    await ensureWidgetModulesRegistered();
}, 120_000);

afterEach(() => {
    vi.useRealTimers();
});

describe("a component tab's undo stack", () => {
    it("is the definition's own scope, not a page's", () => {
        expect(uiEditorHistoryScope(SLOT_SURFACE)).toBe(uiComponentHistoryScope(SLOT));
        expect(uiEditorHistoryScope(PAGE)).toBe(uiSurfaceHistoryScope(PAGE));
    });

    /**
     * One case per write the component editor makes, through the same object the canvas and the
     * inspector write through. Each is one step; undo is the definition exactly as it was, redo is
     * the definition exactly as the edit left it.
     */
    const gestures: Array<[string, (h: ReturnType<typeof createHarness>) => void]> = [
        ["drag (a layout batch)", h => h.slot.updateElementLayouts({ number: { x: 116 }, place: { x: 176 } })],
        ["a typed position", h => h.slot.updateElementLayout("number", { x: 40 })],
        ["resizing the definition's root", h => h.slot.updateElementLayout("slotRoot", { x: 30, width: 500 })],
        ["a text's words", h => h.slot.updateElementProps("number", { text: "02" })],
        ["an appearance field", h => h.slot.updateElementExtra("number", { appearance: { fill: "#ff0000" } })],
        ["an element's animation", h => h.slot.updateElementAnimation("number", { ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS, enterDurationSeconds: 0.5 })],
        ["renaming an element", h => h.slot.renameElement("number", "Slot number")],
        ["binding words to a parameter", h => h.slot.setElementComponentParamBinding("place", "text", "slot")],
        ["reordering children", h => h.slot.reorderChildren("slotRoot", ["frame", "number", "place"])],
        ["moving into a container", h => h.slot.moveElementsInSurface(SLOT_SURFACE, ["number"], "frame", null)],
        ["grouping", h => h.slot.groupElements(SLOT_SURFACE, ["number", "place"])],
        ["ungrouping", h => h.slot.ungroupContainers(SLOT_SURFACE, ["frame"])],
        ["deleting", h => h.slot.deleteElements(["frame"])],
        ["adding an element", h => h.slot.createElement("slotRoot", "nl.text", { x: 300, y: 10 })],
        ["pasting", h => h.slot.pasteClipboardPayload(SLOT_SURFACE, "slotRoot", null, clipboardWithOneText())],
        ["declaring a parameter", h => h.uidoc.setComponentParams(SLOT, [
            { id: "slot", name: "Slot", type: "string", defaultValue: "1" },
            { id: "mode", name: "Mode", type: "string", defaultValue: "save" },
        ])],
        ["renaming the component", h => h.uidoc.renameComponent(SLOT, "Load slot")],
    ];

    for (const [name, gesture] of gestures) {
        it(`takes back ${name} in one step, and gives it back`, () => {
            const h = createHarness();
            const before = h.definition(SLOT);

            gesture(h);
            const after = h.definition(SLOT);
            expect(after).not.toEqual(before);
            expect(h.depth(uiComponentHistoryScope(SLOT)).undo).toBe(1);

            expect(h.uiHistory.undo(SLOT_SURFACE)).toBe(true);
            expect(h.definition(SLOT)).toEqual(before);

            expect(h.uiHistory.redo(SLOT_SURFACE)).toBe(true);
            expect(h.definition(SLOT)).toEqual(after);
        });
    }

    it("keeps a drag that also flips an image to one step, as the page's drag commit does", () => {
        const h = createHarness();
        const before = h.definition(SLOT);

        h.slot.runSurfaceHistoryTransaction(SLOT_SURFACE, () => {
            h.slot.updateElementLayouts({ number: { x: 116, width: -60 } });
            h.slot.updateElementProps("number", { imageFlipX: true });
        });

        expect(h.depth(uiComponentHistoryScope(SLOT)).undo).toBe(1);
        h.uiHistory.undo(SLOT_SURFACE);
        expect(h.definition(SLOT)).toEqual(before);
    });

    it("writes nothing that could be undone for a write that changed nothing but the time stamp", () => {
        const h = createHarness();

        h.slot.updateElementProps("number", { text: "01" });

        expect(h.depth(uiComponentHistoryScope(SLOT)).undo).toBe(0);
    });

    it("leaves a guiding write a gesture makes on its way out of the history", () => {
        const h = createHarness();

        h.slot.updateElementLayout("number", { width: 60 }, { skipHistory: true });
        h.slot.updateElementLayout("number", { x: 20 }, { skipHistory: true });

        expect(h.depth(uiComponentHistoryScope(SLOT)).undo).toBe(0);
    });

    it("puts a deleted widget's own blueprint back with the widget", () => {
        const h = createHarness();
        const ownerKey = componentWidgetMainOwnerKey(SLOT, "frame");
        const blueprint = createMainBlueprint({ id: "bp-frame", name: "frame", owner: { kind: "componentWidgetMain", componentId: SLOT, elementId: "frame" } });
        h.graphDocument.blueprintDocument.blueprints[blueprint.id] = blueprint;
        setPrivateOwnerBlueprint(h.graphDocument.blueprintDocument, ownerKey, blueprint.id);

        h.slot.deleteElements(["frame"]);
        expect(h.graphDocument.blueprintDocument.ownerRecords[ownerKey]).toBeUndefined();

        h.uiHistory.undo(SLOT_SURFACE);
        expect(h.definition(SLOT).elements.frame).toBeDefined();
        expect(h.graphDocument.blueprintDocument.ownerRecords[ownerKey]?.blueprintId).toBe("bp-frame");
        expect(h.graphDocument.blueprintDocument.blueprints["bp-frame"]?.owner).toEqual(blueprint.owner);
    });
});

describe("merging in a component tab", () => {
    it("folds a run of nudges inside the merge window into one step, and starts a new one after it", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(10_000);
        const h = createHarness();
        const scope = uiComponentHistoryScope(SLOT);
        const nudge = (x: number) => h.slot.updateElementLayouts({ number: { x } }, { mergeKey: "nudge:slot:number" });

        nudge(17);
        vi.setSystemTime(10_100);
        nudge(18);
        vi.setSystemTime(10_200);
        nudge(19);
        expect(h.depth(scope).undo).toBe(1);

        h.uiHistory.undo(SLOT_SURFACE);
        expect(h.definition(SLOT).elements.number!.layout.x).toBe(16);
        h.uiHistory.redo(SLOT_SURFACE);
        expect(h.definition(SLOT).elements.number!.layout.x).toBe(19);

        // Past the window, and after an undo, a nudge is a step of its own.
        vi.setSystemTime(20_000);
        nudge(20);
        expect(h.depth(scope).undo).toBe(2);
    });

    it("keeps typing into one field one step, as the page's inspector does", () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(10_000);
        const h = createHarness();

        h.slot.updateElementLayout("number", { x: 1 });
        vi.setSystemTime(10_150);
        h.slot.updateElementLayout("number", { x: 12 });
        vi.setSystemTime(10_300);
        h.slot.updateElementLayout("number", { x: 120 });
        vi.setSystemTime(10_450);
        h.slot.updateElementLayout("number", { y: 9 });

        // x three times is one step; y is another field and its own.
        expect(h.depth(uiComponentHistoryScope(SLOT)).undo).toBe(2);
        h.uiHistory.undo(SLOT_SURFACE);
        h.uiHistory.undo(SLOT_SURFACE);
        expect(h.definition(SLOT).elements.number!.layout).toMatchObject({ x: 16, y: 266 });
    });
});

describe("scopes side by side", () => {
    it("never lets undo in one component tab, another, or a page reach into the others", () => {
        const h = createHarness();
        const slotBefore = h.definition(SLOT);
        const badgeBefore = h.definition(BADGE);

        h.slot.updateElementLayout("number", { x: 200 });
        h.badge.updateElementProps("label", { text: "Hot" });
        h.uidoc.updateElementLayout("pageTitle", { x: 700 });
        const pageTitleMoved = structuredClone(h.uidoc.getDocument().elements.pageTitle);

        // The page's undo takes back the page's edit and nothing else.
        expect(h.uiHistory.undo(PAGE)).toBe(true);
        expect(h.uidoc.getDocument().elements.pageTitle!.layout.x).toBe(600);
        expect(h.definition(SLOT).elements.number!.layout.x).toBe(200);
        expect(h.definition(BADGE).elements.label!.props?.text).toBe("Hot");

        // The badge tab's undo takes back the badge's.
        expect(h.uiHistory.undo(BADGE_SURFACE)).toBe(true);
        expect(h.definition(BADGE)).toEqual(badgeBefore);
        expect(h.definition(SLOT).elements.number!.layout.x).toBe(200);

        // The slot tab's undo takes back the slot's, and leaves the page as it now is.
        h.uiHistory.redo(PAGE);
        expect(h.uiHistory.undo(SLOT_SURFACE)).toBe(true);
        expect(h.definition(SLOT)).toEqual(slotBefore);
        expect(h.uidoc.getDocument().elements.pageTitle).toEqual(pageTitleMoved);
        expect(h.definition(BADGE)).toEqual(badgeBefore);

        // A tab with nothing of its own left has nothing to undo, whatever the others hold.
        expect(h.uiHistory.undo(BADGE_SURFACE)).toBe(false);
        expect(h.uiHistory.undo(SLOT_SURFACE)).toBe(false);
    });

    it("redraws every page that places the definition when an undo puts it back", () => {
        const h = createHarness();
        h.slot.updateElementProps("number", { text: "99" });
        const pageRevision = h.uidoc.getSurfaceContentRevision(PAGE);
        const componentRevision = h.uidoc.getComponentContentRevision(SLOT);

        h.uiHistory.undo(SLOT_SURFACE);

        // The placement holds only the link; what it draws is the restored definition.
        expect(h.uidoc.getDocument().elements.placed!.extra).toEqual({ componentLink: { componentId: SLOT, linked: true } });
        expect(h.definition(SLOT).elements.number!.props?.text).toBe("01");
        // And both the page's card and the definition's card see it as a change to redraw.
        expect(h.uidoc.getSurfaceContentRevision(PAGE)).toBeGreaterThan(pageRevision);
        expect(h.uidoc.getComponentContentRevision(SLOT)).toBeGreaterThan(componentRevision);
    });

    it("records nothing locally while a live session takes the edits", () => {
        const h = createHarness();
        h.uidoc.setOperationSink({ handle: () => true });

        h.slot.updateElementLayout("number", { x: 200 });
        h.slot.runSurfaceHistoryTransaction(SLOT_SURFACE, () => h.slot.deleteElements(["frame"]));

        // Inside a session undo is the session's - sending the inverse of this window's own last
        // operation - and a local snapshot of the definition would be a document nobody agreed to.
        expect(h.depth(uiComponentHistoryScope(SLOT)).undo).toBe(0);
    });
});

function clipboardWithOneText(): UIEditorClipboardPayload {
    return {
        v: 1,
        sourceSurfaceId: PAGE,
        topLevelElementIds: ["copied"],
        elements: {
            copied: element("copied", "nl.text", "pageRoot", [], { x: 5, y: 5 }, { text: "Copied" }),
        },
        widgetMainBlueprints: {},
        widgetValueBlueprints: {},
    };
}
