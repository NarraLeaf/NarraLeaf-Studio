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
