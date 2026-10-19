import { beforeAll, describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UILayout } from "@shared/types/ui-editor/document";
import type { TranslationKey } from "@shared/i18n";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, uiSurfaceHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIEditorHistoryService } from "../ui-editor/UIEditorHistoryService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { UIBlueprintLifecycleCoordinator } from "../ui-editor/UIBlueprintLifecycleCoordinator";
import { applyUiPatch, readUiPatchOps, routeUiPropsPatch } from "./uiPatch";
import { assertUiRevision } from "./tools/uiTools";

/**
 * An agent's `ui_patch` on a real interface document: each operation lands through the editor's own
 * methods, the whole call is one step of undo, a failure part way leaves nothing behind, and a write
 * against a page the author changed since it was read is refused.
 */

const LABEL = { key: "workspace.history.entry.agentEdit" as TranslationKey };

function element(id: string, type: string, parentId: string | null, childrenIds: string[], layout: Partial<UILayout> = {}, props?: Record<string, unknown>): UIElement {
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

function projectDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: "page", name: "Title", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "root" },
            { id: "other", name: "Other", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "otherRoot" },
        ],
        elements: {
            root: element("root", "nl.root", null, ["title", "box"], { width: 1280, height: 720 }),
            title: element("title", "nl.text", "root", [], { x: 10, y: 10 }, { text: "Hello", imageFill: { fit: "cover", assetId: "a" } }),
            box: element("box", "nl.container", "root", [], { x: 100, y: 100, width: 300, height: 200 }),
            otherRoot: element("otherRoot", "nl.root", null, ["otherText"], { width: 1280, height: 720 }),
            otherText: element("otherText", "nl.text", "otherRoot", [], {}, { text: "Other" }),
        },
        components: [],
        meta: {},
    } as UIDocument;
}

function createHarness() {
    let nextId = 0;
    const uidoc = new UIDocumentService();
    const history = new HistoryService();
    const uiHistory = new UIEditorHistoryService();
    const blueprintDocument: BlueprintDocument = { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {}, meta: {} };
    const graphDocument = { blueprintDocument };
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
                        return { getDocument: () => graphDocument, applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument) };
                    case Services.LocalBlueprint:
                        return { applyBlueprintMutation: () => undefined, getBlueprintDocument: () => blueprintDocument };
                    case Services.UIBlueprintLifecycle:
                        return { syncFromUidoc: () => undefined };
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
    const steps = (scopeId: string) => history.describe().find(stack => stack.scopeId === scopeId)?.undo ?? 0;
    const snapshot = () => JSON.parse(JSON.stringify(uidoc.getDocument().elements)) as Record<string, UIElement>;
    return { uidoc, history, context, steps, snapshot };
}

/**
 * The same document with the real blueprint reconcile installed - the hook every interface edit runs,
 * which deletes the graph of a widget that is gone and gives a widget without one an empty graph. The
 * title page's Start button carries a click layer, which is what a careless rollback loses.
 */
function createBlueprintHarness() {
    let nextId = 0;
    const uidoc = new UIDocumentService();
    const history = new HistoryService();
    const uiHistory = new UIEditorHistoryService();
    const local = new LocalBlueprintService();
    const lifecycle = new UIBlueprintLifecycleCoordinator();
    const graphDocument = {
        blueprintDocument: { schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION, blueprints: {}, ownerRecords: {}, meta: {} } as BlueprintDocument,
    };
    let registry = { schemaVersion: 1, entries: {} };
    let saveSchema = { schemaVersion: 1, fields: {} };
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
                        return { getDocument: () => graphDocument, applyGraphMutation: (mutator: (document: typeof graphDocument) => void) => mutator(graphDocument) };
                    case Services.LocalBlueprint:
                        return local;
                    case Services.UIBlueprintLifecycle:
                        return lifecycle;
                    case Services.VariableRegistry:
                        return { getRegistry: () => registry, replaceRegistry: (next: typeof registry) => { registry = next; } };
                    case Services.SaveSchema:
                        return { getSchema: () => saveSchema, replaceSchema: (next: typeof saveSchema) => { saveSchema = next; } };
                    default:
                        throw new Error(`Unexpected service ${serviceId}`);
                }
            },
        } as any,
        commandLineRun: false,
    };
    for (const service of [uidoc, history, uiHistory, local, lifecycle]) {
        service.setContext(context as any);
    }
    (uiHistory as any).init(context);
    const document = projectDocument();
    document.elements.root.childrenIds.push("start");
    document.elements.start = element("start", "nl.button", "root", [], { x: 40, y: 600 });
    (uidoc as any).document = document;
    (uidoc as any).scheduleAutoSave = () => undefined;
    uidoc.setAfterMutateHook(() => lifecycle.syncFromUidoc());
    lifecycle.syncFromUidoc();
    const startBlueprintId = local.getWidgetMainBlueprintId("page", "start")!;
    local.ensureEventGraph(startBlueprintId, "click", "Start the game");
    history.clearAll();
    const startBlueprint = () => graphDocument.blueprintDocument.blueprints[local.getWidgetMainBlueprintId("page", "start") ?? ""];
    const steps = (scopeId: string) => history.describe().find(stack => stack.scopeId === scopeId)?.undo ?? 0;
    const snapshot = () => JSON.parse(JSON.stringify(uidoc.getDocument().elements)) as Record<string, UIElement>;
    return { uidoc, history, local, graphDocument, startBlueprintId, startBlueprint, steps, snapshot };
}

beforeAll(async () => {
    await ensureWidgetModulesRegistered();
}, 120_000);

/** Give `id` a one-variant appearance holding `groups` (and `props` beside it), outside any undo. */
function withAppearance(uidoc: UIDocumentService, id: string, groups: unknown[], props: Record<string, unknown> = {}): void {
    const target = (uidoc as any).document.elements[id] as UIElement;
    target.props = {
        ...(target.props ?? {}),
        ...props,
        appearance: { defaultVariantId: "default", variants: [{ id: "default", name: "Default", propertyGroups: groups }] },
    };
}

/** The value of the default variant's unconditional row for `key`. */
function defaultRow(target: UIElement, key: string): unknown {
    const appearance = target.props?.appearance as any;
    const variant = appearance.variants.find((item: { id: string }) => item.id === appearance.defaultVariantId);
    const group = variant.propertyGroups.find((item: { key?: string }) => item.key === key);
    return group.rows.find((row: { conditions: unknown }) => row.conditions === null).value;
}

describe("applyUiPatch", () => {
    it("lands every operation through the editor's methods, as one undo step", () => {
        const { uidoc, history, steps, snapshot } = createHarness();
        const before = snapshot();
        const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { text: "Welcome", "imageFill.assetId": "b" } },
            { op: "layout", element: "box", x: 40, width: 500 },
            { op: "rename", element: "box", name: "Panel" },
            { op: "add", parent: "Panel", type: "nl.text", id: "caption", name: "Caption", props: { text: "New" }, x: 5, y: 6 },
            { op: "move", element: "title", parent: "Panel", index: 0 },
        ]), LABEL);

        const doc = uidoc.getDocument();
        expect(doc.elements.title.props).toMatchObject({ text: "Welcome", imageFill: { fit: "cover", assetId: "b" } });
        expect(doc.elements.box.layout).toMatchObject({ x: 40, width: 500 });
        expect(doc.elements.box.name).toBe("Panel");
        expect(doc.elements.caption).toMatchObject({ type: "nl.text", name: "Caption", parentId: "box" });
        expect(doc.elements.caption.props).toMatchObject({ text: "New" });
        expect(doc.elements.box.childrenIds).toEqual(["title", "caption"]);
        expect(outcome.created).toEqual([expect.objectContaining({ id: "caption", type: "nl.text", path: "root / Panel / Caption" })]);

        const scope = uiSurfaceHistoryScope("page");
        expect(steps(scope)).toBe(1);
        expect(history.peekUndo(scope)).toEqual(LABEL);
        expect(history.undo(scope)).toBe(true);
        expect(snapshot()).toEqual(before);
        expect(history.redo(scope)).toBe(true);
        expect(uidoc.getDocument().elements.caption?.name).toBe("Caption");
    });

    it("leaves the document as it was, and no step, when an operation fails part way", () => {
        const { uidoc, steps, snapshot } = createHarness();
        const before = snapshot();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { text: "Changed" } },
            { op: "delete", element: "nothing-by-this-name" },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "not_found" }));
        expect(snapshot()).toEqual(before);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("cannot reach another page's elements", () => {
        const { uidoc } = createHarness();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "otherText", props: { text: "x" } },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "not_found" }));
    });

    it("refuses an unknown widget type with the operation's index", () => {
        const { uidoc } = createHarness();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "add", type: "nl.nope" },
        ]), LABEL)).toThrow(/ops\[0\]/);
    });

    it("routes `layout.*` to the element's layout, dotted or nested, so hiding an element hides it", () => {
        const { uidoc, steps } = createHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { "layout.visible": false } },
            { op: "set", element: "title", props: { layout: { opacity: 0.5, visible: false } } },
        ]), LABEL);
        const doc = uidoc.getDocument();
        expect(doc.elements.box.layout.visible).toBe(false);
        expect(doc.elements.box.props?.layout).toBeUndefined();
        expect(doc.elements.title.layout).toMatchObject({ opacity: 0.5, visible: false });
        expect(doc.elements.title.props?.layout).toBeUndefined();
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(1);
    });

    it("splits a patch by bag on the first segment, as the `.ui` format does", () => {
        const target = element("t", "nl.text", null, [], {}, { imageFill: { fit: "cover", assetId: "a" } });
        expect(routeUiPropsPatch(target, {
            "layout.visible": false,
            "style.mixBlendMode": "screen",
            extra: { note: 1 },
            "imageFill.assetId": "b",
            "props.layout": "kept as a prop",
        })).toEqual({
            props: { imageFill: { fit: "cover", assetId: "b" }, layout: "kept as a prop" },
            layout: { visible: false },
            style: { mixBlendMode: "screen" },
            extra: { note: 1 },
            element: {},
        });
        expect(() => routeUiPropsPatch(target, { "layout.visibel": false })).toThrow(/layout has no "visibel"/);
        expect(() => routeUiPropsPatch(target, { "layout.visible": "no" })).toThrow(/true or false/);
        expect(() => routeUiPropsPatch(target, { layout: false })).toThrow(/takes an object/);
    });

    it("writes `style.*` as CSS overrides, a null removing one", () => {
        const { uidoc } = createHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { "style.mixBlendMode": "screen", "style.filter": "blur(2px)" } },
        ]), LABEL);
        expect(uidoc.getDocument().elements.box.style).toEqual({ mixBlendMode: "screen", filter: "blur(2px)" });
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { style: { filter: null } } },
        ]), LABEL);
        expect(uidoc.getDocument().elements.box.style).toEqual({ mixBlendMode: "screen" });
    });

    it("refuses a prop the widget does not know instead of storing it, pointing a bare layout key at `layout.`", () => {
        const { uidoc, steps, snapshot } = createHarness();
        const before = snapshot();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { visible: false } },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "invalid_args", message: expect.stringMatching(/no prop "visible".*layout\.visible/) }));
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { noSuchProp: 1 } },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "invalid_args", message: expect.stringMatching(/nl\.container has no prop "noSuchProp"/) }));
        expect(snapshot()).toEqual(before);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("refuses a word a prop's list does not have, naming the words it takes", () => {
        const { uidoc, steps, snapshot } = createHarness();
        const before = snapshot();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { textWrapMode: "char" } },
        ]), LABEL)).toThrow(expect.objectContaining({
            code: "invalid_args",
            message: expect.stringContaining('textWrapMode is "char"; it takes one of: word, character, nowrap'),
        }));
        expect(snapshot()).toEqual(before);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);

        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { textWrapMode: "character" } },
        ]), LABEL);
        expect(uidoc.getDocument().elements.title.props?.textWrapMode).toBe("character");
    });

    it("skips an operation that changes nothing and names it, recording no step for a call of nothing else", () => {
        const { uidoc, steps } = createHarness();
        for (const op of [
            { op: "set", element: "title", props: { text: "Hello" } },
            { op: "set", element: "box", props: { "layout.visible": true } },
            { op: "layout", element: "box", x: 100 },
            { op: "rename", element: "box", name: "box" },
            { op: "move", element: "box", parent: "root", index: 1 },
        ]) {
            const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([op]), LABEL);
            expect(outcome.skipped).toEqual([expect.objectContaining({ op: 0, kind: op.op, reason: expect.stringMatching(/changes nothing/) })]);
        }
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("applies the rest of a call when one operation is already done, as one step", () => {
        const { uidoc, steps } = createHarness();
        const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { text: "Welcome" } },
            { op: "set", element: "box", props: { "layout.visible": true } },
            { op: "layout", element: "box", x: 40 },
        ]), LABEL);
        expect(outcome.skipped.map(item => item.op)).toEqual([1]);
        const doc = uidoc.getDocument();
        expect(doc.elements.title.props?.text).toBe("Welcome");
        expect(doc.elements.box.layout.x).toBe(40);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(1);
    });

    it("still refuses the whole call for a mistake, even after an operation that was skipped", () => {
        const { uidoc, steps, snapshot } = createHarness();
        const before = snapshot();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { text: "Hello" } },
            { op: "set", element: "box", props: { text: "x" } },
            { op: "set", element: "title", props: { text: "Changed" } },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "invalid_args" }));
        expect(snapshot()).toEqual(before);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("checks a dry run like the real call and writes nothing", () => {
        const { uidoc, steps, snapshot } = createHarness();
        const before = snapshot();
        const revision = uidoc.getSurfaceContentRevision("page");
        const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "add", type: "nl.text", id: "caption", name: "Caption", props: { text: "New" } },
            { op: "set", element: "box", props: { "layout.visible": false } },
        ]), LABEL, { dryRun: true });
        expect(outcome.created).toEqual([expect.objectContaining({ id: "caption" })]);
        expect(snapshot()).toEqual(before);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
        expect(uidoc.getSurfaceContentRevision("page")).toBe(revision);
        expect(applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { "layout.visible": true } },
        ]), LABEL, { dryRun: true }).skipped).toEqual([expect.objectContaining({ op: 0 })]);
    });

    it("draws the size and colour a new text is given, not the ones its appearance was made with", () => {
        const { uidoc } = createHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "add", type: "nl.text", id: "label", props: { text: "Hi", fontSize: 30, color: "#ff0000" } },
        ]), LABEL);
        const label = uidoc.getDocument().elements.label;
        expect(label.props).toMatchObject({ fontSize: 30, color: "#ff0000" });
        // The text is painted from these rows; before, they kept 16 px and the default colour.
        expect(defaultRow(label, "fontSize")).toBe(30);
        expect(defaultRow(label, "color")).toBe("#ff0000");
    });

    it("sets the unconditional row of a written prop and leaves a hover row alone", () => {
        const { uidoc } = createHarness();
        withAppearance(uidoc, "title", [
            { key: "fontSize", rows: [{ conditions: null, value: 16 }, { conditions: { hovered: true }, value: 20 }] },
            { key: "color", rows: [{ conditions: null, value: "#ffffff" }] },
        ]);
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { fontSize: 24 } },
        ]), LABEL);
        const groups = (uidoc.getDocument().elements.title.props!.appearance as any).variants[0].propertyGroups;
        expect(groups[0].rows).toEqual([{ conditions: null, value: 24 }, { conditions: { hovered: true }, value: 20 }]);
        expect(groups[1].rows).toEqual([{ conditions: null, value: "#ffffff" }]);
    });

    it("brings a row already out of step with its prop back in step, rather than reporting no change", () => {
        const { uidoc } = createHarness();
        withAppearance(uidoc, "title", [{ key: "fontSize", rows: [{ conditions: null, value: 16 }] }], { fontSize: 26 });
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { fontSize: 26 } },
        ]), LABEL);
        expect(defaultRow(uidoc.getDocument().elements.title, "fontSize")).toBe(26);
    });

    it("sets the row of an effect the write changed, and not of one it carried along", () => {
        const { uidoc } = createHarness();
        withAppearance(uidoc, "title", [
            { key: "effectBlur", rows: [{ conditions: null, value: 0 }] },
            { key: "effectBlend", rows: [{ conditions: null, value: "multiply" }] },
        ], { effects: { effectBlur: 0, effectBlend: "" } });
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { "effects.effectBlur": 4 } },
        ]), LABEL);
        const title = uidoc.getDocument().elements.title;
        expect(defaultRow(title, "effectBlur")).toBe(4);
        expect(defaultRow(title, "effectBlend")).toBe("multiply");
    });

    it("rebuilds the bare keys of an appearance written whole from the props they repeat", () => {
        const { uidoc } = createHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            {
                op: "set",
                element: "title",
                props: { fontSize: 40, appearance: { defaultVariantId: "default", variants: [{ id: "default", name: "Default", propertyGroups: ["fontSize"] }] } },
            },
        ]), LABEL);
        expect((uidoc.getDocument().elements.title.props!.appearance as any).variants[0].propertyGroups).toEqual([
            { key: "fontSize", rows: [{ conditions: null, value: 40 }] },
        ]);
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "title", props: { appearance: { defaultVariantId: "default", variants: [{ id: "default", name: "Default", propertyGroups: ["noSuchProp"] }] } } },
        ]), LABEL)).toThrow(/"noSuchProp" as a bare key/);
    });

    it("refuses deleting the page root", () => {
        const { uidoc } = createHarness();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "delete", element: "root" },
        ]), LABEL)).toThrow(/root/);
    });
});

describe("applyUiPatch with the blueprint reconcile installed", () => {
    it("leaves a widget's graph alone on a dry run that deletes the widget", () => {
        const { uidoc, graphDocument, startBlueprintId, startBlueprint, steps, snapshot } = createBlueprintHarness();
        const before = JSON.stringify(graphDocument.blueprintDocument);
        const elements = snapshot();
        const revision = uidoc.getRevision();
        const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "delete", element: "start" },
        ]), LABEL, { dryRun: true });
        expect(outcome.deleted).toEqual(["start"]);
        expect(startBlueprint()?.id).toBe(startBlueprintId);
        expect(startBlueprint()?.graphs.eventIds).toEqual(["click"]);
        expect(JSON.stringify(graphDocument.blueprintDocument)).toBe(before);
        expect(snapshot()).toEqual(elements);
        expect(uidoc.getRevision()).toBe(revision);
        expect(uidoc.isDirty()).toBe(false);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("puts a deleted widget's graph back when a later operation fails", () => {
        const { uidoc, graphDocument, startBlueprint, steps, snapshot } = createBlueprintHarness();
        const before = JSON.stringify(graphDocument.blueprintDocument);
        const elements = snapshot();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "delete", element: "start" },
            { op: "set", element: "title", props: { text: "Changed" } },
            { op: "rename", element: "nothing-by-this-name", name: "x" },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "not_found", message: expect.stringContaining("ops[2]") }));
        expect(snapshot()).toEqual(elements);
        expect(startBlueprint()?.graphs.eventIds).toEqual(["click"]);
        expect(JSON.stringify(graphDocument.blueprintDocument)).toBe(before);
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("takes a real delete back with its graph, in one undo", () => {
        const { uidoc, history, startBlueprint, steps } = createBlueprintHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([{ op: "delete", element: "start" }]), LABEL);
        expect(uidoc.getDocument().elements.start).toBeUndefined();
        expect(startBlueprint()).toBeUndefined();
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(1);
        expect(history.undo(uiSurfaceHistoryScope("page"))).toBe(true);
        expect(uidoc.getDocument().elements.start).toBeDefined();
        expect(startBlueprint()?.graphs.eventIds).toEqual(["click"]);
    });
});

function withSaveSlotComponent(uidoc: UIDocumentService): void {
    const doc = uidoc.getDocument();
    doc.components = [{
        id: "slotDef",
        name: "Save slot",
        rootElementId: "slotRoot",
        params: [
            { id: "slot", name: "Slot", type: "string", defaultValue: "1" },
            { id: "mode", name: "Mode", type: "string", defaultValue: "save" },
            { id: "caption", name: "Caption", type: "text", defaultValue: "" },
        ],
        elements: { slotRoot: element("slotRoot", "nl.container", null, [], { width: 385, height: 273 }) },
    }];
}

describe("applyUiPatch page settings", () => {
    it("writes a page setting, dotted or whole, as one undo step that takes it back", () => {
        const { uidoc, history, steps } = createHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "setting", key: "backgroundColor", value: "transparent" },
            { op: "setting", key: "pageAnimation.enter", value: "fade" },
        ]), LABEL);
        const surface = () => uidoc.getDocument().surfaces.find(item => item.id === "page")!;
        expect(surface().settings).toEqual({ backgroundColor: "transparent", pageAnimation: { enter: "fade" } });
        const scope = uiSurfaceHistoryScope("page");
        expect(steps(scope)).toBe(1);
        expect(history.undo(scope)).toBe(true);
        expect(surface().settings).toBeUndefined();
    });

    it("takes a setting away with null, and skips one already held", () => {
        const { uidoc } = createHarness();
        const target = { kind: "surface", surfaceId: "page" } as const;
        applyUiPatch(uidoc, target, readUiPatchOps([{ op: "setting", key: "backgroundColor", value: "#202020" }]), LABEL);
        const again = applyUiPatch(uidoc, target, readUiPatchOps([{ op: "setting", key: "backgroundColor", value: "#202020" }]), LABEL);
        expect(again.skipped).toEqual([expect.objectContaining({ op: 0, kind: "setting" })]);
        applyUiPatch(uidoc, target, readUiPatchOps([{ op: "setting", key: "backgroundColor", value: null }]), LABEL);
        expect(uidoc.getDocument().surfaces.find(item => item.id === "page")!.settings).toBeUndefined();
    });

    it("checks a setting in a dry run and writes nothing", () => {
        const { uidoc, steps } = createHarness();
        applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "setting", key: "backgroundColor", value: "transparent" },
        ]), LABEL, { dryRun: true });
        expect(uidoc.getDocument().surfaces.find(item => item.id === "page")!.settings).toBeUndefined();
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(0);
    });

    it("refuses a setting a page does not have, a wrong shape, and a component target", () => {
        const { uidoc } = createHarness();
        withSaveSlotComponent(uidoc);
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "setting", key: "backgroundColour", value: "red" },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "invalid_args", message: expect.stringMatching(/no setting "backgroundColour".*backgroundColor/) }));
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "setting", key: "backgroundColor", value: 3 },
        ]), LABEL)).toThrow(/colour string/);
        expect(() => applyUiPatch(uidoc, { kind: "component", componentId: "slotDef" }, readUiPatchOps([
            { op: "setting", key: "backgroundColor", value: "red" },
        ]), LABEL)).toThrow(/component has no page settings/);
    });
});

describe("applyUiPatch component params", () => {
    it("places a component with its params, as a `.ui` component line gives them", () => {
        const { uidoc } = createHarness();
        withSaveSlotComponent(uidoc);
        const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "instantiate", component: "Save slot", id: "slot7", params: { slot: 7, mode: "save", "caption.key": "save.caption" } },
        ]), LABEL);
        expect(outcome.created).toEqual([expect.objectContaining({ id: "slot7" })]);
        expect(uidoc.getDocument().elements.slot7.extra?.componentLink).toEqual({
            componentId: "slotDef",
            linked: true,
            params: { slot: "7", mode: "save" },
            paramKeys: { caption: "save.caption" },
        });
    });

    it("changes a placed component's params with set, and skips a value it already holds", () => {
        const { uidoc } = createHarness();
        withSaveSlotComponent(uidoc);
        const target = { kind: "surface", surfaceId: "page" } as const;
        applyUiPatch(uidoc, target, readUiPatchOps([{ op: "instantiate", component: "slotDef", id: "slot1", params: { slot: "1" } }]), LABEL);
        applyUiPatch(uidoc, target, readUiPatchOps([{ op: "set", element: "slot1", params: { slot: "2", mode: "load" } }]), LABEL);
        expect((uidoc.getDocument().elements.slot1.extra?.componentLink as { params?: unknown } | undefined)?.params).toEqual({ slot: "2", mode: "load" });
        const again = applyUiPatch(uidoc, target, readUiPatchOps([{ op: "set", element: "slot1", params: { slot: "2" } }]), LABEL);
        expect(again.skipped).toHaveLength(1);
    });

    it("refuses a param the component does not declare, and params on a widget", () => {
        const { uidoc, snapshot } = createHarness();
        withSaveSlotComponent(uidoc);
        const before = snapshot();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "instantiate", component: "slotDef", params: { slott: "7" } },
        ]), LABEL)).toThrow(expect.objectContaining({ code: "invalid_args", message: expect.stringMatching(/declares no param "slott"/) }));
        expect(snapshot()).toEqual(before);
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", params: { slot: "7" } },
        ]), LABEL)).toThrow(/not a placed component/);
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "instantiate", component: "slotDef", params: { "slot.key": "x" } },
        ]), LABEL)).toThrow(/not a text param/);
    });
});

describe("applyUiPatch element records", () => {
    it("takes `animation` as ui_show prints it, whole or dotted, and null takes it away", () => {
        const { uidoc } = createHarness();
        const target = { kind: "surface", surfaceId: "page" } as const;
        applyUiPatch(uidoc, target, readUiPatchOps([
            { op: "set", element: "box", props: { animation: { enter: "fade" } } },
        ]), LABEL);
        const animated = uidoc.getDocument().elements.box.animation;
        expect(animated).toBeDefined();
        expect(JSON.stringify(animated)).toContain("fade");
        expect(uidoc.getDocument().elements.box.props?.animation).toBeUndefined();
        expect(uidoc.getDocument().elements.box.extra?.animation).toBeUndefined();
        applyUiPatch(uidoc, target, readUiPatchOps([{ op: "set", element: "box", props: { animation: null } }]), LABEL);
        expect(uidoc.getDocument().elements.box.animation).toBeUndefined();
    });

    it("points `extra.animation` at `animation` instead of storing an extra nothing reads", () => {
        const { uidoc } = createHarness();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { "extra.animation": { enter: "fade" } } },
        ]), LABEL)).toThrow(/write `animation`/);
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { extra: { animation: {} } } },
        ]), LABEL)).toThrow(/write `animation`/);
    });

    it("keeps a Page widget's own `props.animation` a prop", () => {
        const target = element("t", "nl.frame", null, []);
        expect(routeUiPropsPatch(target, { "props.animation": { enter: "x" } })).toMatchObject({ props: { animation: { enter: "x" } }, element: {} });
    });
});

describe("applyUiPatch warnings", () => {
    it("warns about a container told to fill with an image and given none", () => {
        const { uidoc } = createHarness();
        const outcome = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { fillType: "image" } },
        ]), LABEL);
        expect(outcome.warnings).toEqual([expect.stringMatching(/box.*no imageFill/)]);
        const fine = applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { imageFill: { mode: "cover", assetId: "a" } } },
        ]), LABEL);
        expect(fine.warnings).toEqual([]);
    });
});

describe("assertUiRevision", () => {
    it("refuses a write against a page the author changed since the agent read it", () => {
        const { uidoc, context } = createHarness();
        const target = { kind: "surface" as const, surfaceId: "page" };
        const read = uidoc.getSurfaceContentRevision("page");
        expect(() => assertUiRevision(context as any, target, read)).not.toThrow();
        // An edit to another page does not make this one stale.
        uidoc.updateElementProps("otherText", { text: "Elsewhere" });
        expect(() => assertUiRevision(context as any, target, read)).not.toThrow();
        // The author's own edit to this page does.
        uidoc.updateElementProps("title", { text: "By hand" });
        expect(() => assertUiRevision(context as any, target, read)).toThrow(expect.objectContaining({ code: "stale_revision" }));
    });
});

describe("UIDocumentService.applyAgentMutation", () => {
    it("records an edit to one page on that page's stack, as one step", () => {
        const { uidoc, history, steps } = createHarness();
        uidoc.applyAgentMutation({ surfaceId: "page" }, LABEL, document => {
            document.elements.title.props = { ...document.elements.title.props, text: "One" };
            document.elements.box.layout = { ...document.elements.box.layout, x: 1 };
        });
        expect(steps(uiSurfaceHistoryScope("page"))).toBe(1);
        history.undo(uiSurfaceHistoryScope("page"));
        expect(uidoc.getDocument().elements.title.props?.text).toBe("Hello");
        expect(uidoc.getDocument().elements.box.layout.x).toBe(100);
    });

    it("records an edit across pages on the project's stack, as one step that undoes both", () => {
        const { uidoc, history, steps } = createHarness();
        uidoc.applyAgentMutation(null, LABEL, document => {
            document.elements.title.props = { ...document.elements.title.props, text: "A" };
            document.elements.otherText.props = { ...document.elements.otherText.props, text: "B" };
        });
        expect(steps(projectHistoryScope())).toBe(1);
        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(uidoc.getDocument().elements.title.props?.text).toBe("Hello");
        expect(uidoc.getDocument().elements.otherText.props?.text).toBe("Other");
        expect(history.redo(projectHistoryScope())).toBe(true);
        expect(uidoc.getDocument().elements.otherText.props?.text).toBe("B");
    });

    it("takes a cross-page edit back with the graph of a widget it deleted, not an empty one", () => {
        const { uidoc, history, startBlueprint } = createBlueprintHarness();
        uidoc.applyAgentMutation(null, LABEL, document => {
            document.elements.root.childrenIds = document.elements.root.childrenIds.filter(id => id !== "start");
            delete document.elements.start;
            document.elements.otherText.props = { ...document.elements.otherText.props, text: "B" };
        });
        expect(startBlueprint()).toBeUndefined();

        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(uidoc.getDocument().elements.start).toBeDefined();
        expect(uidoc.getDocument().elements.otherText.props?.text).toBe("Other");
        expect(startBlueprint()?.graphs.eventIds).toEqual(["click"]);

        expect(history.redo(projectHistoryScope())).toBe(true);
        expect(uidoc.getDocument().elements.start).toBeUndefined();
        expect(startBlueprint()).toBeUndefined();
        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(startBlueprint()?.graphs.eventIds).toEqual(["click"]);
    });

    it("gives a widget a cross-page edit added back the graph the author wrote on it, on redo", () => {
        const { uidoc, history, local, graphDocument } = createBlueprintHarness();
        uidoc.applyAgentMutation(null, LABEL, document => {
            document.elements.extra = element("extra", "nl.button", "root", []);
            document.elements.root.childrenIds = [...document.elements.root.childrenIds, "extra"];
            document.elements.otherText.props = { ...document.elements.otherText.props, text: "B" };
        });
        const extraBlueprintId = local.getWidgetMainBlueprintId("page", "extra")!;
        expect(extraBlueprintId).toBeTruthy();
        local.ensureEventGraph(extraBlueprintId, "hover", "Written by hand");

        expect(history.undo(projectHistoryScope())).toBe(true);
        expect(uidoc.getDocument().elements.extra).toBeUndefined();
        expect(graphDocument.blueprintDocument.blueprints[extraBlueprintId]).toBeUndefined();

        expect(history.redo(projectHistoryScope())).toBe(true);
        expect(uidoc.getDocument().elements.extra).toBeDefined();
        expect(graphDocument.blueprintDocument.blueprints[extraBlueprintId]?.graphs.eventIds).toEqual(["hover"]);
    });
});
