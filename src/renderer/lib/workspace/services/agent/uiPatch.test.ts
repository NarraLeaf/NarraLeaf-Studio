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

beforeAll(async () => {
    await ensureWidgetModulesRegistered();
}, 120_000);

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

    it("refuses an operation that changes nothing, so the count it reports is true", () => {
        const { uidoc, steps } = createHarness();
        for (const op of [
            { op: "set", element: "title", props: { text: "Hello" } },
            { op: "set", element: "box", props: { "layout.visible": true } },
            { op: "layout", element: "box", x: 100 },
            { op: "rename", element: "box", name: "box" },
            { op: "move", element: "box", parent: "root", index: 1 },
        ]) {
            expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([op]), LABEL))
                .toThrow(expect.objectContaining({ code: "check_failed", message: expect.stringMatching(/changes nothing/) }));
        }
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
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "set", element: "box", props: { "layout.visible": true } },
        ]), LABEL, { dryRun: true })).toThrow(expect.objectContaining({ code: "check_failed" }));
    });

    it("refuses deleting the page root", () => {
        const { uidoc } = createHarness();
        expect(() => applyUiPatch(uidoc, { kind: "surface", surfaceId: "page" }, readUiPatchOps([
            { op: "delete", element: "root" },
        ]), LABEL)).toThrow(/root/);
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
});
