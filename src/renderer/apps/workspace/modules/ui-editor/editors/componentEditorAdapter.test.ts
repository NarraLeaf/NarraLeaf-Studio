import { describe, expect, it } from "vitest";
import type { UIComponentDefinition, UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "./componentEditorAdapter";

/**
 * A component editor reads its component as a document of its own, built from the real one.
 *
 * Built afresh on every read, the tab got a new surface object on every render. The tab keys what it
 * does per surface on that object, so all of it ran again on every render - including, before that
 * was keyed on the id, taking the workspace selection back from whatever page the author had clicked.
 */

const COMPONENT_ID = "save-slot";

function element(id: string, parentId: string | null, childrenIds: string[] = []): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 100, opacity: 1, visible: true },
    } as UIElement;
}

function baseDocument(): UIDocument {
    const component: UIComponentDefinition = {
        id: COMPONENT_ID,
        name: "Save slot",
        rootElementId: "slot-root",
        elements: {
            "slot-root": element("slot-root", null, ["frame"]),
            frame: element("frame", "slot-root"),
        },
    } as unknown as UIComponentDefinition;
    return {
        surfaces: [{ id: "page", name: "Save", host: "app", kind: "appSurface", designSize: { width: 1920, height: 1080 }, rootElementId: "page-root" }],
        elements: { "page-root": element("page-root", null) },
        components: [component],
    } as unknown as UIDocument;
}

/** The three reads the adapter makes of the real service, over a document the test can change. */
function fakeBase() {
    const state = { document: baseDocument(), revision: 1 };
    const base = {
        getDocument: () => state.document,
        getRevision: () => state.revision,
        getComponent: (id: string) => (state.document.components ?? []).find(c => c.id === id),
    };
    return { state, base: base as unknown as UIDocumentService };
}

describe("the document a component editor reads", () => {
    it("is the same object, surface included, until the real document changes", () => {
        const { base } = fakeBase();
        const adapter = createComponentDocumentServiceAdapter(base, COMPONENT_ID);

        const first = adapter.getDocument();
        const second = adapter.getDocument();

        expect(second).toBe(first);
        expect(second.surfaces[0]).toBe(first.surfaces[0]);
        expect(first.surfaces[0].id).toBe(getComponentEditorSurfaceId(COMPONENT_ID));
    });

    it("is rebuilt when the real document is edited in place", () => {
        const { state, base } = fakeBase();
        const adapter = createComponentDocumentServiceAdapter(base, COMPONENT_ID);
        const before = adapter.getDocument();

        state.document.components![0].elements.frame.name = "Frame";
        state.revision += 1;
        const after = adapter.getDocument();

        expect(after).not.toBe(before);
        expect(after.elements.frame.name).toBe("Frame");
    });

    it("is rebuilt when the real document is replaced without the revision moving", () => {
        const { state, base } = fakeBase();
        const adapter = createComponentDocumentServiceAdapter(base, COMPONENT_ID);
        const before = adapter.getDocument();

        // A save swaps in a copy with a new timestamp and leaves the revision where it was.
        state.document = { ...state.document, meta: { createdAt: "", updatedAt: "later" } } as UIDocument;
        const after = adapter.getDocument();

        expect(after).not.toBe(before);
        expect(after.meta?.updatedAt).toBe("later");
    });
});
