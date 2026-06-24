import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { isUiContainerDrillLockHit } from "./containerDrillSelection";

function createDocument(): UIDocument {
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
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["slider"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            slider: {
                id: "slider",
                type: "nl.slider",
                parentId: "root",
                childrenIds: ["track", "handle"],
                layout: { x: 0, y: 0, width: 260, height: 40 },
            },
            track: {
                id: "track",
                type: "nl.container",
                parentId: "slider",
                childrenIds: [],
                extra: { sliderSlot: "track" },
                layout: { x: 16, y: 17, width: 228, height: 6 },
            },
            handle: {
                id: "handle",
                type: "nl.container",
                parentId: "slider",
                childrenIds: [],
                extra: { sliderSlot: "handle" },
                layout: { x: 121, y: 9, width: 18, height: 22 },
            },
        },
    };
}

describe("container drill selection", () => {
    it("treats selected sliders as drillable structural parents", () => {
        const document = createDocument();
        const selection = {
            editor: "ui" as const,
            surfaceId: "surface",
            elementIds: ["slider"],
            primaryId: "slider",
        };

        expect(isUiContainerDrillLockHit(document, "surface", selection, "handle")).toBe(true);
        expect(isUiContainerDrillLockHit(document, "surface", selection, "track")).toBe(true);
        expect(isUiContainerDrillLockHit(document, "surface", selection, "slider")).toBe(false);
    });
});
