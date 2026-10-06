import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { movingSelectionTopLeft, resolveGroupDragTranslate, resolveMoveSnapTranslate } from "./useMoveableHandlers";

describe("useMoveableHandlers", () => {
    it("uses child target drag deltas before the group controller delta", () => {
        expect(resolveGroupDragTranslate([14, -6], [200, 300])).toEqual([200, 300]);
    });

    it("falls back to the group controller delta when a child delta is unavailable", () => {
        expect(resolveGroupDragTranslate([8, 9], undefined)).toEqual([8, 9]);
    });

    it("normalizes invalid moveable translate values", () => {
        expect(resolveGroupDragTranslate([Number.NaN, Number.POSITIVE_INFINITY], undefined)).toEqual([0, 0]);
    });
});

/**
 * root(1920x1080)
 *   a     (13,27,100,50)
 *   flip  (110,10,-100,50) - extends left, so its visual left edge is 10
 *   panel (305,407,400,300) - an offset container, off the grid
 *     inner (20,10,40,20)    - at (325,417) on the surface
 */
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
                designSize: { width: 1920, height: 1080 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["a", "flip", "panel"],
                layout: { x: 0, y: 0, width: 1920, height: 1080 },
            },
            a: { id: "a", type: "nl.text", parentId: "root", childrenIds: [], layout: { x: 13, y: 27, width: 100, height: 50 } },
            flip: { id: "flip", type: "nl.text", parentId: "root", childrenIds: [], layout: { x: 110, y: 10, width: -100, height: 50 } },
            panel: {
                id: "panel",
                type: "nl.container",
                parentId: "root",
                childrenIds: ["inner"],
                layout: { x: 305, y: 407, width: 400, height: 300 },
            },
            inner: { id: "inner", type: "nl.text", parentId: "panel", childrenIds: [], layout: { x: 20, y: 10, width: 40, height: 20 } },
        },
    };
}

const NO_GUIDES = { dx: 0, dy: 0, activeGuides: { surfaceId: "surface", vertical: [], horizontal: [] } };

/** Applies a drag the way `finalizeDrag` does and reads where the element ends up on the surface. */
function dropAt(doc: UIDocument, elementId: string, tx: number, ty: number) {
    const layout = doc.elements[elementId].layout;
    const moved: UIDocument = {
        ...doc,
        elements: { ...doc.elements, [elementId]: { ...doc.elements[elementId], layout: { ...layout, x: layout.x + tx, y: layout.y + ty } } },
    };
    return getElementSurfaceTopLeft(moved, elementId);
}

describe("grid snapping while moving", () => {
    it("lands a dragged element's top-left corner on the grid", () => {
        const doc = makeDocument();
        const layout = doc.elements.a.layout;
        // Pointer moved the element by (100, 50): its corner would sit at (113, 77).
        const topLeft = movingSelectionTopLeft(doc, [{ elementId: "a", layout, tx: 100, ty: 50 }]);
        expect(topLeft).toEqual({ x: 113, y: 77 });
        const snap = resolveMoveSnapTranslate(NO_GUIDES, 20, topLeft);
        expect(dropAt(doc, "a", 100 + snap.dx, 50 + snap.dy)).toEqual({ x: 120, y: 80 });
    });

    it("puts a child of an offset container on the screen's grid points", () => {
        const doc = makeDocument();
        const layout = doc.elements.inner.layout;
        const topLeft = movingSelectionTopLeft(doc, [{ elementId: "inner", layout, tx: 7, ty: 3 }]);
        expect(topLeft).toEqual({ x: 332, y: 420 });
        const snap = resolveMoveSnapTranslate(NO_GUIDES, 20, topLeft);
        const landed = dropAt(doc, "inner", 7 + snap.dx, 3 + snap.dy);
        expect(landed).toEqual({ x: 340, y: 420 });
        // Its own coordinates are relative to the panel at (305, 407), so they are off the grid.
        expect([layout.x + 7 + snap.dx, layout.y + 3 + snap.dy]).toEqual([35, 13]);
    });

    it("reads a negative extent's visual edge as the corner", () => {
        const doc = makeDocument();
        const topLeft = movingSelectionTopLeft(doc, [{ elementId: "flip", layout: doc.elements.flip.layout, tx: 3, ty: 0 }]);
        expect(topLeft).toEqual({ x: 13, y: 10 });
        const snap = resolveMoveSnapTranslate(NO_GUIDES, 20, topLeft);
        expect(dropAt(doc, "flip", 3 + snap.dx, snap.dy)).toEqual({ x: 20, y: 20 });
    });

    it("moves a multi-selection as a block, by the corner of the whole selection", () => {
        const doc = makeDocument();
        const topLeft = movingSelectionTopLeft(doc, [
            { elementId: "a", layout: doc.elements.a.layout, tx: 4, ty: 4 },
            { elementId: "inner", layout: doc.elements.inner.layout, tx: 4, ty: 4 },
        ]);
        expect(topLeft).toEqual({ x: 17, y: 31 });
        expect(resolveMoveSnapTranslate(NO_GUIDES, 20, topLeft)).toEqual({ dx: 3, dy: 9 });
    });

    it("lets a guide that caught an axis keep it", () => {
        const guides = {
            dx: 2,
            dy: 0,
            activeGuides: { surfaceId: "surface", vertical: [{ value: 115, kind: "element-edge" as const }], horizontal: [] },
        };
        expect(resolveMoveSnapTranslate(guides, 20, { x: 113, y: 77 })).toEqual({ dx: 2, dy: 3 });
    });

    it("is the guide snap unchanged while grid snapping is off", () => {
        expect(resolveMoveSnapTranslate({ ...NO_GUIDES, dx: 5 }, null, { x: 113, y: 77 })).toEqual({ dx: 5, dy: 0 });
    });
});
