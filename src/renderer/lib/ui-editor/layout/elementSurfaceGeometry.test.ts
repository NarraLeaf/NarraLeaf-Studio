import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { collectSnapGuideLines } from "@/lib/ui-editor/snapping/collectCandidates";
import { getElementSurfaceTopLeft } from "./elementSurfaceGeometry";

function makeDocument(): UIDocument {
    return {
        schemaVersion: 5,
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
                childrenIds: ["container"],
                layout: { x: 0, y: 0, width: 800, height: 600 },
            },
            container: {
                id: "container",
                type: "nl.container",
                parentId: "root",
                childrenIds: ["leaf"],
                layout: { x: 10, y: 20, width: 100, height: 100 },
            },
            leaf: {
                id: "leaf",
                type: "nl.text",
                parentId: "leaf",
                childrenIds: [],
                layout: { x: 5, y: 7, width: 40, height: 30 },
            },
        },
    };
}

describe("element surface geometry", () => {
    it("preserves parent-chain accumulation for valid documents", () => {
        const doc = makeDocument();
        doc.elements.leaf.parentId = "container";

        expect(getElementSurfaceTopLeft(doc, "leaf")).toEqual({ x: 15, y: 27 });
    });

    it("does not loop forever when a reachable element has a cyclic parent chain", () => {
        const doc = makeDocument();

        expect(getElementSurfaceTopLeft(doc, "leaf")).toEqual({ x: 5, y: 7 });
        expect(collectSnapGuideLines(doc, "surface", new Set(), { width: 800, height: 600 })).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ axis: "vertical", value: 5, sourceElementId: "leaf" }),
                expect.objectContaining({ axis: "horizontal", value: 7, sourceElementId: "leaf" }),
            ]),
        );
    });
});
