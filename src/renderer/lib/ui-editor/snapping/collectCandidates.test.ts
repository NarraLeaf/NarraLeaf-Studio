import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { collectSnapGuideLines } from "./collectCandidates";
import { snapTranslateAxisAlignedRect } from "./snapMath";

function documentWithFullSizeElement(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [{
            id: "surface",
            name: "Surface",
            host: "app",
            kind: "appSurface",
            designSize: { width: 800, height: 600 },
            rootElementId: "root",
        }],
        elements: {
            root: {
                id: "root", type: "nl.root", parentId: null, childrenIds: ["box"],
                layout: { x: 0, y: 0, width: 800, height: 600 },
            },
            box: {
                id: "box", type: "nl.container", parentId: "root", childrenIds: [],
                layout: { x: 0, y: 0, width: 800, height: 600 },
            },
        },
    };
}

describe("collectSnapGuideLines", () => {
    it("keeps enabled element guides that coincide with disabled canvas guides", () => {
        const lines = collectSnapGuideLines(
            documentWithFullSizeElement(), "surface", new Set(), { width: 800, height: 600 },
            { snapElementLayout: true, snapElementBorder: true, snapCanvasLayout: false, snapGrid: false },
        );

        expect(lines).toEqual(expect.arrayContaining([
            { axis: "vertical", value: 0, kind: "element-edge", sourceElementId: "box" },
            { axis: "vertical", value: 400, kind: "element-center", sourceElementId: "box" },
        ]));
        const result = snapTranslateAxisAlignedRect({
            rect: { x: 4, y: 100, width: 20, height: 20 },
            verticalLines: lines.filter(line => line.axis === "vertical"),
            horizontalLines: [], thresholdSurface: 8, surfaceId: "surface",
        });
        expect(result.dx).toBe(-4);
        expect(result.activeGuides.vertical).toEqual([{ value: 0, kind: "element-edge" }]);
    });

    it("keeps canvas guides when coincident element guides are disabled", () => {
        const lines = collectSnapGuideLines(
            documentWithFullSizeElement(), "surface", new Set(), { width: 800, height: 600 },
            { snapElementLayout: false, snapElementBorder: false, snapCanvasLayout: true, snapGrid: false },
        );
        expect(lines).toHaveLength(6);
        expect(lines.every(line => line.kind.startsWith("surface-"))).toBe(true);
    });
});
