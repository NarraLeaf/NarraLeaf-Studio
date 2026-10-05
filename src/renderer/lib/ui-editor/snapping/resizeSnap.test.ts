import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { snapResizeLayoutInSurface } from "./resizeSnap";
import type { SnapGuideLine } from "./types";

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
                childrenIds: ["box"],
                layout: { x: 0, y: 0, width: 800, height: 600 },
            },
            box: {
                id: "box",
                type: "nl.container",
                parentId: "root",
                childrenIds: [],
                layout: { x: 100, y: 100, width: 100, height: 50, lockAspectRatio: true },
            },
        },
    };
}

describe("snapResizeLayoutInSurface", () => {
    it("preserves aspect ratio when a locked bottom-right resize snaps horizontally", () => {
        const verticalLines: SnapGuideLine[] = [
            { axis: "vertical", value: 300, kind: "element-edge", sourceElementId: "guide" },
        ];

        const snapped = snapResizeLayoutInSurface(
            makeDocument(),
            "box",
            { x: 100, y: 100, width: 194, height: 97, rotation: 0 },
            [1, 1],
            verticalLines,
            [],
            1,
            "surface",
            { preserveAspectRatio: true, aspectRatio: 2 },
        );

        expect(snapped.layout.x).toBeCloseTo(100);
        expect(snapped.layout.y).toBeCloseTo(100);
        expect(snapped.layout.width).toBeCloseTo(200);
        expect(snapped.layout.height).toBeCloseTo(100);
        expect(snapped.activeGuides.vertical).toEqual([{ value: 300, kind: "element-edge" }]);
        expect(snapped.activeGuides.horizontal).toEqual([]);
    });

    it("keeps the opposite corner anchored when a locked top-left resize snaps", () => {
        const verticalLines: SnapGuideLine[] = [
            { axis: "vertical", value: 90, kind: "element-edge", sourceElementId: "guide" },
        ];

        const snapped = snapResizeLayoutInSurface(
            makeDocument(),
            "box",
            { x: 94, y: 97, width: 126, height: 63, rotation: 0 },
            [-1, -1],
            verticalLines,
            [],
            1,
            "surface",
            { preserveAspectRatio: true, aspectRatio: 2 },
        );

        expect(snapped.layout.x).toBeCloseTo(90);
        expect(snapped.layout.y).toBeCloseTo(95);
        expect(snapped.layout.width).toBeCloseTo(130);
        expect(snapped.layout.height).toBeCloseTo(65);
        expect(snapped.activeGuides.vertical).toEqual([{ value: 90, kind: "element-edge" }]);
        expect(snapped.activeGuides.horizontal).toEqual([]);
    });
});

/**
 * root(800x600)
 *   box   (100,100,100,50)
 *   panel (305,407,400,300) - an offset container, off the grid
 *     child (20,10,100,50)  - at (325,417) on the surface
 */
function makeGridDocument(): UIDocument {
    const doc = makeDocument();
    doc.elements.root.childrenIds = ["box", "panel"];
    doc.elements.box.layout = { x: 100, y: 100, width: 100, height: 50 };
    doc.elements.panel = {
        id: "panel",
        type: "nl.container",
        parentId: "root",
        childrenIds: ["child"],
        layout: { x: 305, y: 407, width: 400, height: 300 },
    };
    doc.elements.child = {
        id: "child",
        type: "nl.container",
        parentId: "panel",
        childrenIds: [],
        layout: { x: 20, y: 10, width: 100, height: 50 },
    };
    return doc;
}

describe("snapResizeLayoutInSurface with grid snapping", () => {
    it("puts a dragged right edge on the nearest grid line", () => {
        const snapped = snapResizeLayoutInSurface(
            makeGridDocument(),
            "box",
            { x: 100, y: 100, width: 113, height: 50, rotation: 0 },
            [1, 0],
            [],
            [],
            1,
            "surface",
            { gridSpacing: 20 },
        );
        expect(snapped.layout).toEqual({ x: 100, y: 100, width: 120, height: 50 });
        expect(snapped.activeGuides).toEqual({ surfaceId: "surface", vertical: [], horizontal: [] });
    });

    it("leaves the edge where the pointer put it while grid snapping is off", () => {
        const snapped = snapResizeLayoutInSurface(
            makeGridDocument(),
            "box",
            { x: 100, y: 100, width: 113, height: 50, rotation: 0 },
            [1, 0],
            [],
            [],
            1,
            "surface",
            { gridSpacing: null },
        );
        expect(snapped.layout.width).toBe(113);
    });

    it("lets a guide within reach win over the grid, and draws it", () => {
        const verticalLines: SnapGuideLine[] = [
            { axis: "vertical", value: 215, kind: "element-edge", sourceElementId: "guide" },
        ];
        const snapped = snapResizeLayoutInSurface(
            makeGridDocument(),
            "box",
            { x: 100, y: 100, width: 113, height: 50, rotation: 0 },
            [1, 0],
            verticalLines,
            [],
            1,
            "surface",
            { gridSpacing: 20 },
        );
        expect(snapped.layout.width).toBe(115);
        expect(snapped.activeGuides.vertical).toEqual([{ value: 215, kind: "element-edge" }]);
    });

    it("snaps a child's edges to the screen's grid, not to its container's", () => {
        // Left edge of the child dragged to x=323 on the surface (local 18): the screen's grid line is
        // 320, which is local 15 inside the panel at 305.
        const snapped = snapResizeLayoutInSurface(
            makeGridDocument(),
            "child",
            { x: 18, y: 10, width: 102, height: 50, rotation: 0 },
            [-1, 1],
            [],
            [],
            1,
            "surface",
            { gridSpacing: 20 },
        );
        expect(snapped.layout.x).toBeCloseTo(15);
        expect(snapped.layout.width).toBeCloseTo(105);
        // Bottom edge: 417 + 50 = 467 on the surface goes to 460, so the height is 43.
        expect(snapped.layout.y).toBeCloseTo(10);
        expect(snapped.layout.height).toBeCloseTo(43);
    });

    it("keeps a locked ratio and puts the nearer of the two dragged edges on the grid", () => {
        // Right edge at 231 is 9 from 240; bottom edge at 142 is 2 from 140, so the bottom wins.
        const snapped = snapResizeLayoutInSurface(
            makeGridDocument(),
            "box",
            { x: 105, y: 100, width: 126, height: 42, rotation: 0 },
            [1, 1],
            [],
            [],
            1,
            "surface",
            { preserveAspectRatio: true, aspectRatio: 3, gridSpacing: 20 },
        );
        expect(snapped.layout.x).toBeCloseTo(105);
        expect(snapped.layout.y).toBeCloseTo(100);
        expect(snapped.layout.height).toBeCloseTo(40);
        expect(snapped.layout.width).toBeCloseTo(120);
    });
});
