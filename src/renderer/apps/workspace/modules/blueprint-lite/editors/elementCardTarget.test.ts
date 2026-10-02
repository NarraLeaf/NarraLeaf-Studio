/**
 * An Element card on a component definition's blueprint finds the element it names.
 *
 * A reference written inside a definition names the definition's own surface, which is in no
 * document's surface list, and an element that lives in the definition rather than in the document's
 * element table. Looked up the way a page's reference is, every such card found nothing, and drew the
 * element's id and an empty preview where its name and its preview belong.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import { buildUIComponentSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { getComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { createElementCardTargetResolver } from "./elementCardTarget";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], name?: string): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 30, y: 40, width: 200, height: 100 },
        ...(name ? { name } : {}),
    };
}

const document: UIDocument = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
        { id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 640, height: 360 }, rootElementId: "pageRoot" },
    ],
    elements: {
        pageRoot: element("pageRoot", "nl.root", null, ["pageText"]),
        pageText: element("pageText", "nl.text", "pageRoot", [], "Page words"),
    },
    components: [
        {
            id: "slotDef",
            name: "Save slot",
            rootElementId: "slotRoot",
            elements: {
                slotRoot: element("slotRoot", "nl.container", null, ["slotThumb", "slotName"], "Slot"),
                slotThumb: element("slotThumb", "nl.image", "slotRoot", [], "Thumbnail"),
                slotName: element("slotName", "nl.text", "slotRoot", [], "Location"),
            },
        },
    ],
};

describe("what an Element card draws", () => {
    it("finds an element on a page on that page, in the project's document", () => {
        const target = createElementCardTargetResolver(document)({ surfaceId: "page", elementId: "pageText" });

        expect(target?.element.name).toBe("Page words");
        expect(target?.surface.id).toBe("page");
        expect(target?.document).toBe(document);
    });

    it("finds an element of a component definition in the definition, drawn as a placement draws it", () => {
        const target = createElementCardTargetResolver(document)({
            surfaceId: buildUIComponentSurfaceId("slotDef"),
            elementId: "slotName",
        });

        expect(target?.element.name).toBe("Location");
        expect(target?.surface.id).toBe(buildUIComponentSurfaceId("slotDef"));
        expect(target?.surface.rootElementId).toBe("slotRoot");
        // The definition's elements beside the project's, which is what a widget inside it draws from.
        expect(target?.document.surfaces.some(surface => surface.id === target.surface.id)).toBe(true);
        expect(target?.document.elements.slotThumb?.name).toBe("Thumbnail");
        expect(target?.document.elements.pageText?.name).toBe("Page words");
    });

    it("reads the surface id the element picker writes inside a definition as the same tree", () => {
        const resolve = createElementCardTargetResolver(document);
        const picked = resolve({ surfaceId: getComponentEditorSurfaceId("slotDef"), elementId: "slotThumb" });
        const written = resolve({ surfaceId: buildUIComponentSurfaceId("slotDef"), elementId: "slotThumb" });

        expect(picked?.element.name).toBe("Thumbnail");
        expect(picked?.element).toBe(written?.element);
    });

    it("draws the definition's root where a placement draws it, at the origin with no parent", () => {
        const target = createElementCardTargetResolver(document)({
            surfaceId: buildUIComponentSurfaceId("slotDef"),
            elementId: "slotRoot",
        });

        expect(target?.element.parentId).toBeNull();
        expect(target?.element.layout).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
        // The stored definition is not touched.
        expect(document.components?.[0]?.elements.slotRoot?.layout.x).toBe(30);
    });

    it("gives a definition no background of its own", () => {
        const target = createElementCardTargetResolver(document)({
            surfaceId: buildUIComponentSurfaceId("slotDef"),
            elementId: "slotName",
        });

        expect(target?.surface.settings?.backgroundColor).toBe("transparent");
    });

    it("hands every card in one definition the same drawing, so a preview is not redrawn for nothing", () => {
        const resolve = createElementCardTargetResolver(document);
        const first = resolve({ surfaceId: buildUIComponentSurfaceId("slotDef"), elementId: "slotName" });
        const second = resolve({ surfaceId: buildUIComponentSurfaceId("slotDef"), elementId: "slotThumb" });
        const again = resolve({ surfaceId: buildUIComponentSurfaceId("slotDef"), elementId: "slotName" });

        expect(second?.document).toBe(first?.document);
        expect(second?.surface).toBe(first?.surface);
        expect(again?.element).toBe(first?.element);
    });

    it("finds nothing for an element that is gone, so the card can say it is missing", () => {
        const resolve = createElementCardTargetResolver(document);

        expect(resolve({ surfaceId: "page", elementId: "deleted" })).toBeNull();
        expect(resolve({ surfaceId: "deletedPage", elementId: "pageText" })).toBeNull();
        expect(resolve({ surfaceId: buildUIComponentSurfaceId("slotDef"), elementId: "deleted" })).toBeNull();
        expect(resolve({ surfaceId: buildUIComponentSurfaceId("deletedDef"), elementId: "slotName" })).toBeNull();
    });

    it("does not find a page's element through a definition's surface", () => {
        const target = createElementCardTargetResolver(document)({
            surfaceId: buildUIComponentSurfaceId("slotDef"),
            elementId: "pageText",
        });

        expect(target).toBeNull();
    });
});
