import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { getOutlineVisualChildren, resolveBeforeChildIdForOutlineGap } from "./outlineDropGeometry";

function makeDocument(rootProps?: Record<string, unknown>, rootType = "nl.root"): UIDocument {
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
                type: rootType,
                parentId: null,
                childrenIds: ["back", "middle", "front"],
                layout: { x: 0, y: 0, width: 800, height: 600 },
                ...(rootProps ? { props: rootProps } : {}),
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

/** The parent's children after a drop on `gap`, applied the way `applyPlannedMove` applies it. */
function dropOrder(doc: UIDocument, movers: string[], gap: number): string[] {
    const before = resolveBeforeChildIdForOutlineGap(doc, "root", movers, gap);
    const rest = doc.elements.root.childrenIds.filter(id => !movers.includes(id));
    const at = before == null ? rest.length : rest.indexOf(before);
    rest.splice(at, 0, ...movers);
    return rest;
}

/** A stack: the children of a flow container, first child first. */
const stackDocument = () => makeDocument({ layoutKind: "stack" }, "nl.container");

describe("outline drop geometry", () => {
    it("shows front-most children first in a free container", () => {
        expect(getOutlineVisualChildren(makeDocument().elements.root)).toEqual(["front", "middle", "back"]);
    });

    it("shows a stack's children in the order it lays them out", () => {
        expect(getOutlineVisualChildren(stackDocument().elements.root)).toEqual(["back", "middle", "front"]);
    });

    it("maps visible outline gaps back to document insertion points", () => {
        const doc = makeDocument();

        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 0)).toBeNull();
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 1)).toBe("front");
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 2)).toBe("middle");
        expect(resolveBeforeChildIdForOutlineGap(doc, "root", [], 3)).toBe("back");
    });

    it("leaves a layer where it was when it is dropped on either gap beside its own row", () => {
        const doc = makeDocument();

        expect(dropOrder(doc, ["middle"], 1)).toEqual(["back", "middle", "front"]);
        expect(dropOrder(doc, ["middle"], 2)).toEqual(["back", "middle", "front"]);
    });

    it("lands a layer dragged down the outline on the gap it was dropped on", () => {
        // Outline: front, middle, back. Dropping `front` between middle and back puts it behind
        // middle and in front of back.
        expect(dropOrder(makeDocument(), ["front"], 2)).toEqual(["back", "front", "middle"]);
    });

    it("reorders a stack in the direction the row moved", () => {
        const doc = stackDocument();

        // Outline: back, middle, front. Dragging `back` below `middle` lays it out after middle.
        expect(dropOrder(doc, ["back"], 2)).toEqual(["middle", "back", "front"]);
        // And dragging `front` to the top lays it out first.
        expect(dropOrder(doc, ["front"], 0)).toEqual(["front", "back", "middle"]);
        // Its own gaps leave it where it was.
        expect(dropOrder(doc, ["middle"], 1)).toEqual(["back", "middle", "front"]);
        expect(dropOrder(doc, ["middle"], 2)).toEqual(["back", "middle", "front"]);
    });

    it("places a row coming from another parent at the gap it was dropped on", () => {
        // Movers that are not children of this parent take up no row in it.
        expect(resolveBeforeChildIdForOutlineGap(stackDocument(), "root", ["elsewhere"], 1)).toBe("middle");
        expect(resolveBeforeChildIdForOutlineGap(makeDocument(), "root", ["elsewhere"], 1)).toBe("front");
    });
});
