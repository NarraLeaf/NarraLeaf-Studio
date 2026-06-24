import { describe, expect, it } from "vitest";
import {
    isUIElementFlowLayoutChild,
    UI_DOCUMENT_SCHEMA_VERSION,
    uiElementTypeAcceptsUserChildren,
    type UIDocument,
} from "./document";

function createListSlotDocument(): UIDocument {
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
                childrenIds: ["list"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            list: {
                id: "list",
                type: "nl.list",
                parentId: "root",
                childrenIds: ["item", "track", "thumb"],
                layout: { x: 0, y: 0, width: 240, height: 160 },
            },
            item: {
                id: "item",
                type: "nl.container",
                parentId: "list",
                childrenIds: [],
                extra: { listSlot: "itemTemplate" },
                layout: { x: 0, y: 0, width: 200, height: 36 },
            },
            track: {
                id: "track",
                type: "nl.container",
                parentId: "list",
                childrenIds: [],
                extra: { listSlot: "scrollbarTrack" },
                layout: { x: 224, y: 0, width: 8, height: 160 },
            },
            thumb: {
                id: "thumb",
                type: "nl.container",
                parentId: "list",
                childrenIds: [],
                extra: { listSlot: "scrollbarThumb" },
                layout: { x: 224, y: 0, width: 8, height: 32 },
            },
        },
    };
}

function createSliderPartsDocument(): UIDocument {
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
                props: {
                    value: 50,
                    min: 0,
                    max: 100,
                    step: 1,
                    orientation: "horizontal",
                    trackElementId: "track",
                    handleElementId: "handle",
                },
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

describe("UI document flow layout", () => {
    it("keeps list item templates in flow but lets scrollbar parts use authored free layout", () => {
        const doc = createListSlotDocument();

        expect(isUIElementFlowLayoutChild(doc, doc.elements.item!)).toBe(true);
        expect(isUIElementFlowLayoutChild(doc, doc.elements.track!)).toBe(false);
        expect(isUIElementFlowLayoutChild(doc, doc.elements.thumb!)).toBe(false);
    });

    it("treats slider track and handle as authored internal parts", () => {
        const doc = createSliderPartsDocument();

        expect(uiElementTypeAcceptsUserChildren("nl.slider")).toBe(false);
        expect(isUIElementFlowLayoutChild(doc, doc.elements.track!)).toBe(false);
        expect(isUIElementFlowLayoutChild(doc, doc.elements.handle!)).toBe(false);
    });
});
