import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { createReadOnlyDocumentService, ReadOnlyDocumentError } from "./readOnlyDocumentService";

/**
 * The layer the comparison inspector cannot do without.
 *
 * The greying out of its controls is an affordance and this is the enforcement, so what is pinned
 * here is the refusal itself: a write that reaches this object throws rather than doing nothing,
 * because a mutator that quietly returns would leave a field looking as though it had taken the
 * edit. And a mutator nobody has thought of yet throws too - the service gains methods, and an
 * adapter that only refused the ones known when it was written would pass the next one through.
 */

function element(id: string, over: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10, opacity: 1, visible: true },
        ...over,
    } as UIElement;
}

function document(): UIDocument {
    return {
        version: 11,
        name: "Interface",
        surfaces: [
            {
                id: "main",
                name: "Main",
                host: "app",
                kind: "appSurface",
                designSize: { width: 1920, height: 1080 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: element("root", { childrenIds: ["panel"] }),
            panel: element("panel", { parentId: "root" }),
        },
        components: [],
    } as unknown as UIDocument;
}

describe("createReadOnlyDocumentService", () => {
    it("answers the document it was given, without a workspace behind it", () => {
        const doc = document();
        const service = createReadOnlyDocumentService(doc, null);
        expect(service.getDocument()).toBe(doc);
        expect(service.getRevision()).toBe(0);
        expect(service.isDirty()).toBe(false);
        expect(service.getComponent("nothing")).toBeUndefined();
    });

    it("subscribes without ever notifying, and hands back a cleanup", () => {
        const service = createReadOnlyDocumentService(document(), null);
        expect(() => service.onDocumentChanged(() => undefined)()).not.toThrow();
        expect(() => service.onDirtyChanged(() => undefined)()).not.toThrow();
    });

    it("throws on every write rather than discarding it", () => {
        const service = createReadOnlyDocumentService(document(), null);
        expect(() => service.updateElementLayout("panel", { x: 1 })).toThrow(ReadOnlyDocumentError);
        expect(() => service.updateElementProps("panel", { text: "x" })).toThrow(ReadOnlyDocumentError);
        expect(() => service.renameElement("panel", "other")).toThrow(ReadOnlyDocumentError);
        expect(() => service.deleteElements(["panel"])).toThrow(ReadOnlyDocumentError);
        expect(() => service.createElement("root", "nl.text")).toThrow(ReadOnlyDocumentError);
        expect(() => service.reorderChildren("root", [])).toThrow(ReadOnlyDocumentError);
        expect(() => service.updateElementAnimation("panel", null)).toThrow(ReadOnlyDocumentError);
        // The document itself is untouched by any of it.
        expect(service.getDocument().elements.panel.layout.x).toBe(0);
    });

    it("refuses a member it has never heard of", () => {
        const service = createReadOnlyDocumentService(document(), null) as unknown as Record<
            string,
            () => void
        >;
        expect(() => service.someMethodAddedNextYear()).toThrow(ReadOnlyDocumentError);
    });

    it("refuses a workspace it was not given, rather than inventing one", () => {
        const service = createReadOnlyDocumentService(document(), null);
        expect(() => service.getContext()).toThrow(ReadOnlyDocumentError);
    });

    it("is not mistaken for a promise, and survives a symbol probe", () => {
        const service = createReadOnlyDocumentService(document(), null) as unknown as Record<
            PropertyKey,
            unknown
        >;
        expect(service.then).toBeUndefined();
        expect(service[Symbol.toPrimitive]).toBeUndefined();
    });
});
