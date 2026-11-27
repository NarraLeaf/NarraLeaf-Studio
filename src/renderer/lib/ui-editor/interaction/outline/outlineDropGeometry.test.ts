import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import {
    getOutlineVisualChildren,
    listVisibleOutlineRows,
    planOutlineDrop,
    resolveBeforeChildIdForOutlineGap,
    resolveOutlineDropZone,
} from "./outlineDropGeometry";

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

describe("row drops", () => {
    const doc = {
        elements: {
            root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["a", "panel"], layout: { x: 0, y: 0, width: 1, height: 1 } },
            a: { id: "a", type: "nl.text", parentId: "root", childrenIds: [], layout: { x: 0, y: 0, width: 1, height: 1 } },
            panel: { id: "panel", type: "nl.container", parentId: "root", childrenIds: ["b", "c"], layout: { x: 0, y: 0, width: 1, height: 1 } },
            b: { id: "b", type: "nl.text", parentId: "panel", childrenIds: [], layout: { x: 0, y: 0, width: 1, height: 1 } },
            c: { id: "c", type: "nl.text", parentId: "panel", childrenIds: [], layout: { x: 0, y: 0, width: 1, height: 1 } },
        },
    } as unknown as UIDocument;
    const accepts = (el: { type: string }) => el.type === "nl.root" || el.type === "nl.container";

    it("splits a row into above, into and below, or two halves when it takes no children", () => {
        expect(resolveOutlineDropZone(0, 100, 10, true)).toBe("before");
        expect(resolveOutlineDropZone(0, 100, 50, true)).toBe("inside");
        expect(resolveOutlineDropZone(0, 100, 90, true)).toBe("after");
        expect(resolveOutlineDropZone(0, 100, 40, false)).toBe("before");
        expect(resolveOutlineDropZone(0, 100, 60, false)).toBe("after");
    });

    it("drops into a container at the top of its list", () => {
        expect(planOutlineDrop(doc, ["a"], { rowId: "panel", zone: "inside" }, accepts)).toEqual({ parentId: "panel", visualIndex: 0 });
    });

    it("drops beside a row at its place in the outline (front-most first)", () => {
        // panel lists c above b (front-most on top).
        expect(planOutlineDrop(doc, ["a"], { rowId: "b", zone: "before" }, accepts)).toEqual({ parentId: "panel", visualIndex: 1 });
        expect(planOutlineDrop(doc, ["a"], { rowId: "b", zone: "after" }, accepts)).toEqual({ parentId: "panel", visualIndex: 2 });
    });

    it("offers nowhere on or inside what is being dragged, into a leaf, or beside the root", () => {
        expect(planOutlineDrop(doc, ["panel"], { rowId: "b", zone: "before" }, accepts)).toBeNull();
        expect(planOutlineDrop(doc, ["panel"], { rowId: "panel", zone: "inside" }, accepts)).toBeNull();
        expect(planOutlineDrop(doc, ["b"], { rowId: "a", zone: "inside" }, accepts)).toBeNull();
        expect(planOutlineDrop(doc, ["a"], { rowId: "root", zone: "before" }, accepts)).toBeNull();
    });

    it("lists the rows the outline shows, skipping collapsed branches", () => {
        expect(listVisibleOutlineRows(doc, "root", () => false)).toEqual(["root", "panel", "c", "b", "a"]);
        expect(listVisibleOutlineRows(doc, "root", id => id === "panel")).toEqual(["root", "panel", "a"]);
    });
});
