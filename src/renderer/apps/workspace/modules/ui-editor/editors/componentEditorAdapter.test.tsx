/**
 * The component editor edits a definition against a document of its own, and a Page widget authored
 * there still names one of the project's pages.
 *
 * That document used to list the definition's surface and nothing else. So a Page widget inside a
 * definition could not be pointed at any page from its own inspector (the picker offered the
 * definition, which it then refused as itself), and one that already named a page - pasted in, or
 * made on a page and turned into a component - drew "Missing Page" on this canvas.
 *
 * Comments in English per project convention.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { getUIFrameTargetInvalidReason } from "@shared/types/ui-editor/frame";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { createComponentDocumentServiceAdapter, getComponentEditorSurfaceId } from "./componentEditorAdapter";

const CHILD_WORDS = "Drawn by the child page";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], props?: Record<string, unknown>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 100 }, ...(props ? { props } : {}) };
}

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        { id: "host", name: "Host", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "root" },
        { id: "child", name: "Child", host: "app", kind: "appSurface", designSize: { width: 200, height: 100 }, rootElementId: "childRoot" },
    ],
    elements: {
        root: element("root", "nl.root", null, []),
        childRoot: element("childRoot", "nl.root", null, ["childText"]),
        childText: element("childText", "nl.text", "childRoot", [], { text: CHILD_WORDS }),
    },
    components: [
        {
            id: "cardDef",
            name: "Card",
            rootElementId: "cardRoot",
            elements: {
                cardRoot: element("cardRoot", "nl.container", null, ["window"]),
                window: element("window", "nl.frame", "cardRoot", [], { targetSurfaceId: "child" }),
            },
        },
    ],
};

const base = {
    getDocument: () => document,
    getRevision: () => 1,
    getComponent: (componentId: string) => document.components?.find(component => component.id === componentId),
} as unknown as UIDocumentService;

describe("the component editor's document", () => {
    it("lists the project's pages beside the definition, and holds only the definition's elements", () => {
        const edited = createComponentDocumentServiceAdapter(base, "cardDef").getDocument();

        expect(edited.surfaces.map(surface => surface.id)).toEqual([getComponentEditorSurfaceId("cardDef"), "host", "child"]);
        expect(edited.elements.childText).toBeUndefined();
        expect(edited.elements.window?.type).toBe("nl.frame");
    });

    it("lets a Page widget in the definition name a project page", () => {
        const edited = createComponentDocumentServiceAdapter(base, "cardDef").getDocument();

        expect(getUIFrameTargetInvalidReason({
            document: edited,
            sourceSurfaceId: getComponentEditorSurfaceId("cardDef"),
            frameElementId: "window",
            targetSurfaceId: "child",
        })).toBeNull();
    });

    it("draws that page on the component editor's canvas", () => {
        const edited = createComponentDocumentServiceAdapter(base, "cardDef").getDocument();
        const surface = edited.surfaces[0]!;

        const markup = renderToStaticMarkup(
            <>
                {SurfaceElementTree({
                    document: edited,
                    pageDocument: document,
                    surface,
                    rootElement: edited.elements[surface.rootElementId]!,
                    rendererRegistry: new ElementRendererRegistry(BuiltinElementRenderers),
                    hostAdapter: { host: "app" },
                })}
            </>,
        );

        expect(markup).toContain('data-ui-surface-id="child"');
        expect(markup).toContain(CHILD_WORDS);
    });
});

/**
 * The editor tab reads this document on every render and keys what it does per surface on the
 * surface object. Built afresh on every read, that object was new each time, so everything the tab
 * keeps per surface ran again on every render - including, while that was keyed on the object, taking
 * the workspace selection back from whatever page the author had clicked.
 */
describe("the component editor's document between changes", () => {
    /** The reads the adapter makes of the real service, over a document the test can change. */
    function changingBase() {
        const state = { document: structuredClone(document), revision: 1 };
        const service = {
            getDocument: () => state.document,
            getRevision: () => state.revision,
            getComponent: (componentId: string) =>
                state.document.components?.find(component => component.id === componentId),
        } as unknown as UIDocumentService;
        return { state, service };
    }

    it("is the same object, surface included, until the real document changes", () => {
        const { service } = changingBase();
        const adapter = createComponentDocumentServiceAdapter(service, "cardDef");

        const first = adapter.getDocument();
        const second = adapter.getDocument();

        expect(second).toBe(first);
        expect(second.surfaces[0]).toBe(first.surfaces[0]);
    });

    it("is rebuilt when the real document is edited in place", () => {
        const { state, service } = changingBase();
        const adapter = createComponentDocumentServiceAdapter(service, "cardDef");
        const before = adapter.getDocument();

        state.document.components![0]!.elements.window!.name = "Window";
        state.revision += 1;
        const after = adapter.getDocument();

        expect(after).not.toBe(before);
        expect(after.elements.window?.name).toBe("Window");
    });

    it("is rebuilt when the real document is replaced without the revision moving", () => {
        const { state, service } = changingBase();
        const adapter = createComponentDocumentServiceAdapter(service, "cardDef");
        const before = adapter.getDocument();

        // A save swaps in a copy with a new timestamp and leaves the revision where it was.
        state.document = { ...state.document, name: "Saved" };
        const after = adapter.getDocument();

        expect(after).not.toBe(before);
        expect(after.name).toBe("Saved");
    });
});
