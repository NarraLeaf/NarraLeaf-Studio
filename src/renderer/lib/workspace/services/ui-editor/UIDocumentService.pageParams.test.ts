import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIDocument, UIElement, UIPageParam } from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { setActiveUIPageParams } from "@shared/types/ui-editor/pageParams";
import { Services } from "../services";
import { HistoryService } from "../history/HistoryService";
import { UIDocumentService } from "./UIDocumentService";

function createService(): UIDocumentService {
    let nextId = 0;
    const service = new UIDocumentService();
    const projectHistory = new HistoryService();
    service.setContext({
        project: { resolve: (name: string) => name } as any,
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.Uuid) {
                    return { generate: () => `generated-id-${++nextId}` };
                }
                if (serviceId === Services.Project) {
                    return { getProjectConfig: () => ({ metadata: { resolution: { width: 1280, height: 720 } } }) };
                }
                if (serviceId === Services.History) {
                    return projectHistory;
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        } as any,
        commandLineRun: false,
    });
    (service as any).document = (service as any).createEmptyDocument();
    return service;
}

function list(id: string, parentId: string, key: string): UIElement {
    return {
        id,
        type: "nl.list",
        parentId,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props: { itemsBinding: { kind: "pageProp", key } },
    };
}

/** A second page whose root holds one list, beside the document's own first page. */
function addPage(document: UIDocument, surfaceId: string, rootId: string, listId: string, key: string): void {
    document.surfaces.push({
        id: surfaceId,
        name: surfaceId,
        host: "app",
        kind: "appSurface",
        designSize: { width: 1280, height: 720 },
        rootElementId: rootId,
    });
    document.elements[rootId] = {
        id: rootId,
        type: "nl.root",
        parentId: null,
        childrenIds: [listId],
        layout: { x: 0, y: 0, width: 1280, height: 720 },
    };
    document.elements[listId] = list(listId, rootId, key);
}

const MESSAGE: UIPageParam = { id: "message", name: "message", type: "string" };
const BUTTONS: UIPageParam = { id: "buttons", name: "buttons", type: "json", defaultValue: [] };

describe("UIDocumentService page parameters", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        setActiveUIPageParams([]);
    });

    it("stores a page's parameters in the shape it reads, and none as no field at all", () => {
        const service = createService();
        service.setPageParams(MAIN_APP_SURFACE_ID, [
            MESSAGE,
            { id: "count", name: " count ", type: "number", defaultValue: "3" },
            { id: "dupe", name: "message", type: "string" },
        ]);
        const surface = () => service.getDocument().surfaces.find(item => item.id === MAIN_APP_SURFACE_ID) as { params?: unknown };
        expect(surface().params).toEqual([MESSAGE, { id: "count", name: "count", type: "number", defaultValue: 3 }]);
        service.setPageParams(MAIN_APP_SURFACE_ID, []);
        expect("params" in surface()).toBe(false);
    });

    it("moves a list on the page to a renamed parameter, and leaves other pages alone", () => {
        const service = createService();
        const document = service.getDocument();
        const rootId = document.surfaces[0]!.rootElementId;
        document.elements[rootId]!.childrenIds.push("rows");
        document.elements.rows = list("rows", rootId, "buttons");
        addPage(document, "other", "other-root", "other-rows", "buttons");
        service.setPageParams(MAIN_APP_SURFACE_ID, [MESSAGE, BUTTONS]);

        service.setPageParams(MAIN_APP_SURFACE_ID, [MESSAGE, { ...BUTTONS, name: "choices" }]);

        const keyOf = (id: string) => (service.getDocument().elements[id]!.props!.itemsBinding as { key: string }).key;
        expect(keyOf("rows")).toBe("choices");
        expect(keyOf("other-rows")).toBe("buttons");
    });

    it("follows two names swapped in one edit", () => {
        const service = createService();
        const document = service.getDocument();
        const rootId = document.surfaces[0]!.rootElementId;
        document.elements[rootId]!.childrenIds.push("a", "b");
        document.elements.a = list("a", rootId, "first");
        document.elements.b = list("b", rootId, "second");
        service.setPageParams(MAIN_APP_SURFACE_ID, [
            { id: "p1", name: "first", type: "json" },
            { id: "p2", name: "second", type: "json" },
        ]);
        service.setPageParams(MAIN_APP_SURFACE_ID, [
            { id: "p1", name: "second", type: "json" },
            { id: "p2", name: "first", type: "json" },
        ]);
        const keyOf = (id: string) => (service.getDocument().elements[id]!.props!.itemsBinding as { key: string }).key;
        expect([keyOf("a"), keyOf("b")]).toEqual(["second", "first"]);
    });

    it("reads a stored document's parameters through the normaliser, and drops a Game UI's", () => {
        const service = createService();
        const stored: UIDocument = JSON.parse(JSON.stringify(service.getDocument()));
        const rootElementId = stored.surfaces[0]!.rootElementId;
        stored.surfaces[0] = { ...stored.surfaces[0]!, params: [MESSAGE, { id: "bad id", name: "x", type: "string" }] } as never;
        stored.surfaces.push({
            id: "dialog",
            name: "Dialog",
            host: "player",
            kind: "stageSurface",
            designSize: { width: 1280, height: 720 },
            rootElementId,
            mount: { kind: "slot", slotId: "dialog" },
            params: [MESSAGE],
        } as never);
        const loaded = (service as any).migrateIfNeeded(stored) as UIDocument;
        expect((loaded.surfaces[0] as { params?: unknown }).params).toEqual([MESSAGE]);
        expect("params" in loaded.surfaces[1]!).toBe(false);
    });
});
