import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { getOutlineVisualChildren, resolveBeforeChildIdForOutlineGap } from "./outlineDropGeometry";

function makeDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 800, height: 600 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["back", "middle", "front"],
                layout: { x: 0, y: 0, width: 800, height: 600 },
            },
            back: {
                id: "back",
                type: "nl.container",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 100, height: 100 },
            },
            middle: {
                id: "middle",
                type: "nl.container",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 100, height: 100 },
            },
            front: {
                id: "front",
                type: "nl.container",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 100, height: 100 },
            },
        },
    };
}

describe("outline drop geometry", () => {
    it("shows front-most children first", () => {
        const doc = makeDocument();

        expect(getOutlineVisualChildren(doc.elements.root)).toEqual(["front", "middle", "back"]);
    });

    it("maps visible outline gaps back to document insertion points", () => {
        const doc = makeDocument();

        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 0)).toBeNull();
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 1)).toBe("front");
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 2)).toBe("middle");
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 3)).toBe("back");
    });

    it("ignores movers while resolving their new visible gap", () => {
        const doc = makeDocument();

        expect(resolveBeforeChildIdForOutlineGap(doc, "root", ["middle"], 1)).toBe("front");
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", ["middle"], 2)).toBe("back");
    });
});
