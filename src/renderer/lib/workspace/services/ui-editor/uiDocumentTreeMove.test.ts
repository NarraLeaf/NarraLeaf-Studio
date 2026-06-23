import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import {
    applyPlannedMove,
    normalizeFlowChildLayouts,
} from "./uiDocumentTreeMove";

function element(
    id: string,
    type: string,
    parentId: string | null,
    childrenIds: string[] = [],
    patch: Partial<UIElement> = {},
): UIElement {
    return {
        id,
        type,
        parentId,
        childrenIds,
        layout: { x: 24, y: 36, width: 100, height: 50 },
        ...patch,
    };
}

function makeDocument(elements: Record<string, UIElement>): UIDocument {
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
        elements,
    };
}

describe("uiDocumentTreeMove flow layout normalization", () => {
    it("neutralizes direct flow-child coordinates without changing authored size or rotation", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["stack", "free"]),
            stack: element("stack", "nl.container", "root", ["flow"], {
                props: { layoutKind: "stack" },
            }),
            flow: element("flow", "nl.text", "stack", [], {
                layout: { x: 18, y: 22, width: 140, height: 32, rotation: 15 },
            }),
            free: element("free", "nl.container", "root", ["absolute"], {
                props: { layoutKind: "free" },
            }),
            absolute: element("absolute", "nl.text", "free", [], {
                layout: { x: 9, y: 11, width: 80, height: 20 },
            }),
        });

        expect(normalizeFlowChildLayouts(document)).toBe(true);

        expect(document.elements.flow.layout).toMatchObject({
            x: 0,
            y: 0,
            width: 140,
            height: 32,
            rotation: 15,
        });
        expect(document.elements.absolute.layout).toMatchObject({ x: 9, y: 11 });
    });

    it("keeps list scrollbar parts out of flow-child coordinate normalization", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["list"]),
            list: element("list", "nl.list", "root", ["item", "track"]),
            item: element("item", "nl.text", "list", [], {
                extra: { listSlot: "itemTemplate" },
                layout: { x: 40, y: 50, width: 100, height: 24 },
            }),
            track: element("track", "nl.container", "list", [], {
                extra: { listSlot: "scrollbarTrack" },
                layout: { x: 7, y: 8, width: 12, height: 100 },
            }),
        });

        normalizeFlowChildLayouts(document);

        expect(document.elements.item.layout).toMatchObject({ x: 0, y: 0 });
        expect(document.elements.track.layout).toMatchObject({ x: 7, y: 8 });
    });

    it("normalizes stale coordinates when reordering inside the same flow parent", () => {
        const document = makeDocument({
            root: element("root", "nl.root", null, ["stack"]),
            stack: element("stack", "nl.container", "root", ["a", "b"], {
                props: { layoutKind: "stack" },
            }),
            a: element("a", "nl.text", "stack", [], {
                layout: { x: 10, y: 20, width: 80, height: 20 },
            }),
            b: element("b", "nl.text", "stack", [], {
                layout: { x: 30, y: 40, width: 80, height: 20 },
            }),
        });

        applyPlannedMove(document, {
            movers: ["b"],
            targetParentId: "stack",
            beforeChildId: "a",
        });

        expect(document.elements.stack.childrenIds).toEqual(["b", "a"]);
        expect(document.elements.b.layout).toMatchObject({ x: 0, y: 0 });
    });
});
