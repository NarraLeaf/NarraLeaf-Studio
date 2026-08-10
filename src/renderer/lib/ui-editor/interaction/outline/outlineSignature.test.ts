import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { computeOutlineSignature } from "./outlineSignature";

function element(id: string, parentId: string | null, childrenIds: string[] = [], overrides: Partial<UIElement> = {}): UIElement {
    return {
        id,
        type: "nl.container",
        name: id,
        parentId,
        childrenIds,
        layout: { x: 0, y: 0, width: 100, height: 40, visible: true, opacity: 1 },
        ...overrides,
    };
}

function surfaceDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "ui-doc",
        name: "UI",
        surfaces: [
            { id: "surface-a", name: "A", host: "app", kind: "appSurface", designSize: { width: 1280, height: 720 }, rootElementId: "root" },
        ],
        elements: {
            root: element("root", null, ["a", "b"], { type: "nl.root" }),
            a: element("a", "root", ["a1"]),
            a1: element("a1", "a"),
            b: element("b", "root"),
        },
        meta: {},
    };
}

const signature = (document: UIDocument) => computeOutlineSignature(document, "surface-a");

describe("computeOutlineSignature", () => {
    it("ignores everything the outline does not draw", () => {
        const document = surfaceDocument();
        const before = signature(document);

        document.elements.a.layout.x = 400;
        document.elements.a.layout.width = 33;
        document.elements.a.layout.opacity = 0.2;
        document.elements.a.props = { text: "typed a character" };
        document.elements.a.style = { color: "red" };

        expect(signature(document)).toBe(before);
    });

    it("notices a rename", () => {
        const document = surfaceDocument();
        const before = signature(document);
        document.elements.a.name = "Renamed";
        expect(signature(document)).not.toBe(before);
    });

    it("notices hiding a layer", () => {
        const document = surfaceDocument();
        const before = signature(document);
        document.elements.a.layout.visible = false;
        expect(signature(document)).not.toBe(before);
    });

    it("notices a reorder", () => {
        const document = surfaceDocument();
        const before = signature(document);
        document.elements.root.childrenIds = ["b", "a"];
        expect(signature(document)).not.toBe(before);
    });

    it("notices an added and a removed layer", () => {
        const document = surfaceDocument();
        const before = signature(document);

        document.elements.c = element("c", "root");
        document.elements.root.childrenIds = ["a", "b", "c"];
        const added = signature(document);
        expect(added).not.toBe(before);

        document.elements.root.childrenIds = ["a", "b"];
        delete document.elements.c;
        expect(signature(document)).toBe(before);
    });

    it("notices a reparent", () => {
        const document = surfaceDocument();
        const before = signature(document);
        document.elements.a.childrenIds = [];
        document.elements.b.childrenIds = ["a1"];
        document.elements.a1.parentId = "b";
        expect(signature(document)).not.toBe(before);
    });

    it("notices the type changing, because the row shows it", () => {
        const document = surfaceDocument();
        const before = signature(document);
        document.elements.b.type = "nl.text";
        expect(signature(document)).not.toBe(before);
    });

    // Only reachable from a damaged document, but this runs on every change and must not hang.
    it("terminates on a parent cycle", () => {
        const document = surfaceDocument();
        document.elements.a.childrenIds = ["a1"];
        document.elements.a1.childrenIds = ["a"];
        expect(() => signature(document)).not.toThrow();
    });

    it("is empty for a surface that is not in the document", () => {
        expect(computeOutlineSignature(surfaceDocument(), "nope")).toBe("");
    });
});
