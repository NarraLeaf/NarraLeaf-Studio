/**
 * Undo in the interface editor while a team project's server owns the document.
 *
 * With the server's sink installed an edit does not land here when it is made - it is sent, and the
 * document changes when the server's effect comes back. The page snapshot the editor records
 * everywhere else saw nothing change, so Ctrl+Z after moving an element had no step to take. These
 * pin the team step that replaced it: one step per edit, undo and redo sent through the server as
 * ordinary edits, refused (and kept) where they would overwrite somebody's later change or the edit
 * has not come back yet, and never a page snapshot written behind the server's back.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveUIOp } from "@shared/live/ops";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UILayout } from "@shared/types/ui-editor/document";
import { HistoryService } from "../history/HistoryService";
import { Services } from "../services";
import { UIDocumentService } from "./UIDocumentService";
import { UIEditorHistoryService } from "./UIEditorHistoryService";

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({}),
    getPrivilegedInterface: () => ({ fs: { writeFileNoFollowOrCreate: vi.fn(), isDirExists: vi.fn(), createDir: vi.fn() } }),
}));

const PAGE = "page";
const OTHER = "other";

function element(id: string, parentId: string | null, childrenIds: string[], layout: Partial<UILayout> = {}): UIElement {
    return {
        id,
        type: parentId === null ? "nl.root" : "nl.text",
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40, opacity: 1, visible: true, ...layout },
        props: { text: id },
    };
}

function projectDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            { id: PAGE, name: "Title", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "root" },
            { id: OTHER, name: "Options", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "otherRoot" },
        ],
        elements: {
            root: element("root", null, ["start", "quit"], { width: 1280, height: 720 }),
            start: element("start", "root", [], { x: 10, y: 10 }),
            quit: element("quit", "root", [], { x: 10, y: 80 }),
            otherRoot: element("otherRoot", null, [], { width: 1280, height: 720 }),
        },
        meta: {},
    } as UIDocument;
}

/**
 * The interface services with a team server stand-in: every edit the sink takes is queued, and
 * `deliver` applies the queue the way the server's effects arrive. `stranger` lands an edit made by
 * somebody else, which arrives without ever passing through this window's sink.
 */
function createHarness() {
    let nextId = 0;
    const uidoc = new UIDocumentService();
    const history = new HistoryService();
    const uiHistory = new UIEditorHistoryService();
    const warning = vi.fn();
    const graphDocument = { blueprintDocument: { schemaVersion: 1, blueprints: {}, ownerRecords: {}, meta: {} } };
    const context = {
        project: { resolve: (name: string) => name } as never,
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
                        return { getDocument: () => graphDocument, applyGraphMutation: (mutate: (d: unknown) => void) => mutate(graphDocument) };
                    case Services.UIBlueprintLifecycle:
                        return { syncFromUidoc: () => undefined };
                    case Services.UI:
                        return { notifications: { warning } };
                    default:
                        throw new Error(`Unexpected service ${String(serviceId)}`);
                }
            },
        } as never,
        commandLineRun: false,
    };
    uidoc.setContext(context as never);
    history.setContext(context as never);
    uiHistory.setContext(context as never);
    (uiHistory as never as { init: (ctx: unknown) => void }).init(context);
    (uidoc as never as { document: UIDocument }).document = projectDocument();
    (uidoc as never as { scheduleAutoSave: () => void }).scheduleAutoSave = () => undefined;

    const sent: LiveUIOp[] = [];
    const connect = () => uidoc.setOperationSink({ handle: op => { sent.push(op); return true; } });
    connect();

    const deliver = () => {
        for (const op of sent.splice(0)) {
            uidoc.applyLiveOp(op);
        }
    };
    const stranger = (elementId: string, layout: Partial<UILayout>) => {
        const record = structuredClone(uidoc.getDocument().elements[elementId]);
        record.layout = { ...record.layout, ...layout };
        uidoc.applyLiveOp({ op: "write-ui", parts: { elements: { [elementId]: record } } });
    };
    const layout = (elementId: string) => uidoc.getDocument().elements[elementId].layout;

    return { uidoc, history, uiHistory, warning, sent, deliver, stranger, layout, connect };
}

describe("undo in a team project's interface editor", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("leaves a step for a move that has only been sent, and puts the element back through the server", () => {
        const h = createHarness();

        h.uidoc.updateElementLayouts({ start: { x: 300, y: 200 } });
        expect(h.uiHistory.canUndo(PAGE)).toBe(true);
        h.deliver();
        expect(h.layout("start")).toMatchObject({ x: 300, y: 200 });

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        // Sent, not written here: the screen changes when the server's effect comes back.
        expect(h.layout("start")).toMatchObject({ x: 300, y: 200 });
        expect(h.sent).toHaveLength(1);
        expect(Object.keys(h.sent[0].op === "write-ui" ? h.sent[0].parts.elements ?? {} : {})).toEqual(["start"]);
        h.deliver();
        expect(h.layout("start")).toMatchObject({ x: 10, y: 10 });
        expect(h.uiHistory.canRedo(PAGE)).toBe(true);

        expect(h.uiHistory.redo(PAGE)).toBe(true);
        h.deliver();
        expect(h.layout("start")).toMatchObject({ x: 300, y: 200 });
        expect(h.warning).not.toHaveBeenCalled();
    });

    it("refuses, and keeps the step, when somebody changed the element since", () => {
        const h = createHarness();
        h.uidoc.updateElementLayouts({ start: { x: 300 } });
        h.deliver();
        h.stranger("start", { y: 500 });

        expect(h.uiHistory.undo(PAGE)).toBe(false);
        expect(h.sent).toEqual([]);
        expect(h.layout("start")).toMatchObject({ x: 300, y: 500 });
        expect(h.warning).toHaveBeenCalledTimes(1);
        expect(h.uiHistory.canUndo(PAGE)).toBe(true);
    });

    it("takes its own element back without touching another author's on the same page", () => {
        const h = createHarness();
        h.uidoc.updateElementLayouts({ start: { x: 300 } });
        h.deliver();
        h.stranger("quit", { x: 900 });

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        h.deliver();
        expect(h.layout("start").x).toBe(10);
        expect(h.layout("quit").x).toBe(900);
    });

    it("refuses while the edit is still on its way, and treats one that never came back as nothing", () => {
        vi.useFakeTimers();
        const h = createHarness();
        h.uidoc.updateElementLayouts({ start: { x: 300 } });

        expect(h.uiHistory.undo(PAGE)).toBe(false);
        expect(h.warning).toHaveBeenCalledTimes(1);
        expect(h.uiHistory.canUndo(PAGE)).toBe(true);

        // The server never answered (it refused the edit): nothing on screen to take back.
        h.sent.splice(0);
        vi.advanceTimersByTime(6000);
        expect(h.uiHistory.undo(PAGE)).toBe(true);
        expect(h.sent).toEqual([]);
        expect(h.layout("start").x).toBe(10);
    });

    it("folds a run of keystrokes into one field into one step", () => {
        const h = createHarness();
        h.uidoc.updateElementProps("start", { text: "S" });
        h.deliver();
        h.uidoc.updateElementProps("start", { text: "St" });
        h.deliver();
        h.uidoc.updateElementProps("start", { text: "Sta" });
        h.deliver();

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        h.deliver();
        expect(h.uidoc.getDocument().elements.start.props?.text).toBe("start");
        expect(h.uiHistory.canUndo(PAGE)).toBe(false);
    });

    it("records a transaction's edits as one step", () => {
        const h = createHarness();
        h.uidoc.runSurfaceHistoryTransaction(PAGE, () => {
            h.uidoc.updateElementLayouts({ start: { x: 300 } });
            h.uidoc.updateElementLayouts({ quit: { x: 400 } });
        });
        h.deliver();

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        h.deliver();
        expect(h.layout("start").x).toBe(10);
        expect(h.layout("quit").x).toBe(10);
        expect(h.uiHistory.canUndo(PAGE)).toBe(false);
    });

    it("keeps a page another author added when a rename is taken back", () => {
        const h = createHarness();
        h.uidoc.renameSurface(PAGE, "Main menu");
        h.deliver();
        const added = { id: "added", name: "Credits", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "addedRoot" } as const;
        h.uidoc.applyLiveOp({
            op: "write-ui",
            parts: {
                elements: { addedRoot: element("addedRoot", null, [], { width: 1280, height: 720 }) },
                surfaces: { added },
                surfaceOrder: [PAGE, OTHER, "added"],
            },
        });

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        h.deliver();
        const surfaces = h.uidoc.getDocument().surfaces;
        expect(surfaces.map(surface => surface.id)).toEqual([PAGE, OTHER, "added"]);
        expect(surfaces[0].name).toBe("Title");
    });

    it("applies a team step here when the server is gone", () => {
        const h = createHarness();
        h.uidoc.updateElementLayouts({ start: { x: 300 } });
        h.deliver();
        h.uidoc.setOperationSink(null);

        expect(h.uiHistory.undo(PAGE)).toBe(true);
        expect(h.layout("start").x).toBe(10);
    });

    it("will not write a snapshot step recorded offline into the copy behind the server's back", () => {
        const h = createHarness();
        h.uidoc.setOperationSink(null);
        h.uidoc.updateElementLayouts({ start: { x: 300 } });
        expect(h.layout("start").x).toBe(300);
        h.connect();

        expect(h.uiHistory.undo(PAGE)).toBe(false);
        expect(h.layout("start").x).toBe(300);
        expect(h.warning).toHaveBeenCalledTimes(1);
        expect(h.uiHistory.canUndo(PAGE)).toBe(true);
    });
});
