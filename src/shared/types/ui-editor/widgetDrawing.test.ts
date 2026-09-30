/**
 * Which drawing of an element a graph means, from where the graph is running.
 *
 * The rule under test is the one every element-targeting node reaches through the runtime. Each case
 * here is a sentence an author would say about a screen - "press a tile, show the viewer", "press a
 * scene, mark its chapter" - and the address it has to land on for the thing on screen to change.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { buildUIComponentInstanceKey } from "./componentInstanceKey";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIComponentDefinition, type UIDocument, type UIElement } from "./document";
import { buildUIListItemInstanceKey } from "./list";
import { buildUIWidgetAddress } from "./widgetAddress";
import { resolveUIElementDrawingKey, resolveUIWidgetAddressFromDrawing } from "./widgetDrawing";

type Spec = {
    type: string;
    parent: string | null;
    slot?: "itemTemplate" | "scrollbarTrack" | "scrollbarThumb";
    placesComponent?: string;
};

function elementsOf(specs: Record<string, Spec>): Record<string, UIElement> {
    const out: Record<string, UIElement> = {};
    for (const [id, spec] of Object.entries(specs)) {
        const extra: Record<string, unknown> = {};
        if (spec.slot) {
            extra.listSlot = spec.slot;
        }
        if (spec.placesComponent) {
            extra.componentLink = { componentId: spec.placesComponent, linked: true };
        }
        out[id] = {
            id,
            type: spec.type,
            parentId: spec.parent,
            childrenIds: Object.entries(specs).filter(([, child]) => child.parent === id).map(([childId]) => childId),
            layout: { x: 0, y: 0, width: 10, height: 10 },
            ...(Object.keys(extra).length > 0 ? { extra } : {}),
        };
    }
    return out;
}

function documentOf(page: Record<string, Spec>, components: Record<string, { root: string; elements: Record<string, Spec> }> = {}): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "page",
                name: "Page",
                host: "app",
                kind: "appSurface",
                designSize: { width: 100, height: 100 },
                rootElementId: "root",
            },
        ],
        elements: elementsOf(page),
        components: Object.entries(components).map(([id, def]): UIComponentDefinition => ({
            id,
            name: id,
            rootElementId: def.root,
            elements: elementsOf(def.elements),
        })),
    };
}

/**
 * A gallery screen: a list of tiles, each with a lock mark and a card placement, beside a viewer
 * panel and under a list with an authored scrollbar.
 */
const gallery = documentOf(
    {
        root: { type: "nl.root", parent: null },
        viewer: { type: "nl.container", parent: "root" },
        grid: { type: "nl.list", parent: "root" },
        tile: { type: "nl.container", parent: "grid", slot: "itemTemplate" },
        mark: { type: "nl.text", parent: "tile" },
        legacyChild: { type: "nl.text", parent: "grid" },
        card: { type: "nl.container", parent: "tile", placesComponent: "cardDef" },
        track: { type: "nl.container", parent: "grid", slot: "scrollbarTrack" },
    },
    {
        cardDef: {
            root: "cardRoot",
            elements: {
                cardRoot: { type: "nl.container", parent: null },
                badge: { type: "nl.text", parent: "cardRoot" },
            },
        },
    },
);

const row = buildUIListItemInstanceKey(undefined, "grid", "cg-2");
const cardInRow = buildUIComponentInstanceKey(row, "card");

describe("a graph running in a list row", () => {
    it("addresses an element outside the list as that element, not as the row's copy of it", () => {
        // The gesture the rule is for: press a tile, show the viewer beside the list.
        expect(resolveUIWidgetAddressFromDrawing(gallery, "viewer", row)).toBe("viewer");
    });

    it("keeps an element of the row's own template in that row", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "mark", row)).toBe(buildUIWidgetAddress("mark", row));
        expect(resolveUIWidgetAddressFromDrawing(gallery, "tile", row)).toBe(buildUIWidgetAddress("tile", row));
    });

    it("counts a child with no slot as template, as the renderer does", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "legacyChild", row)).toBe(buildUIWidgetAddress("legacyChild", row));
    });

    it("addresses the list itself as the list - an Item Click writing to its own list", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "grid", row)).toBe("grid");
    });

    it("draws an authored scrollbar once per list, not once per row", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "track", row)).toBe("track");
    });

    it("leaves every address alone outside any drawing", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "mark", undefined)).toBe("mark");
        expect(resolveUIWidgetAddressFromDrawing(gallery, "viewer", "")).toBe("viewer");
    });
});

describe("a graph running in a component placed in a list row", () => {
    it("keeps the placement's own widgets in that placement, in that row", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "badge", cardInRow)).toBe(buildUIWidgetAddress("badge", cardInRow));
        expect(resolveUIWidgetAddressFromDrawing(gallery, "cardRoot", cardInRow)).toBe(buildUIWidgetAddress("cardRoot", cardInRow));
    });

    it("finds the row's other widgets in the row, one drawing out", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "mark", cardInRow)).toBe(buildUIWidgetAddress("mark", row));
        // The placement element is part of the row, not of its own definition.
        expect(resolveUIWidgetAddressFromDrawing(gallery, "card", cardInRow)).toBe(buildUIWidgetAddress("card", row));
    });

    it("finds a widget outside the list on the page", () => {
        expect(resolveUIWidgetAddressFromDrawing(gallery, "viewer", cardInRow)).toBe("viewer");
    });
});

describe("a graph running in a row of a list inside another list's row", () => {
    // Chapters, each with its scenes. A press on a scene may mean the scene's own label, the
    // chapter heading it sits under, the scenes list, or something on the page.
    const chapters = documentOf({
        root: { type: "nl.root", parent: null },
        viewer: { type: "nl.container", parent: "root" },
        chapterList: { type: "nl.list", parent: "root" },
        chapterRow: { type: "nl.container", parent: "chapterList", slot: "itemTemplate" },
        chapterTitle: { type: "nl.text", parent: "chapterRow" },
        sceneList: { type: "nl.list", parent: "chapterRow" },
        sceneRow: { type: "nl.container", parent: "sceneList", slot: "itemTemplate" },
        sceneLabel: { type: "nl.text", parent: "sceneRow" },
    });
    const chapterRow = buildUIListItemInstanceKey(undefined, "chapterList", "ch-1");
    const sceneRow = buildUIListItemInstanceKey(chapterRow, "sceneList", "s-3");

    it("keeps the scene's own label in that scene of that chapter", () => {
        expect(resolveUIWidgetAddressFromDrawing(chapters, "sceneLabel", sceneRow)).toBe(buildUIWidgetAddress("sceneLabel", sceneRow));
    });

    it("lands a write to the chapter heading in the chapter the scene belongs to", () => {
        expect(resolveUIWidgetAddressFromDrawing(chapters, "chapterTitle", sceneRow)).toBe(buildUIWidgetAddress("chapterTitle", chapterRow));
    });

    it("finds the scenes list in its chapter, which is where it is drawn", () => {
        expect(resolveUIWidgetAddressFromDrawing(chapters, "sceneList", sceneRow)).toBe(buildUIWidgetAddress("sceneList", chapterRow));
    });

    it("finds the page's viewer on the page", () => {
        expect(resolveUIWidgetAddressFromDrawing(chapters, "viewer", sceneRow)).toBe("viewer");
    });
});

describe("a graph running in a list row inside a component placement", () => {
    const saveScreen = documentOf(
        {
            root: { type: "nl.root", parent: null },
            panel: { type: "nl.container", parent: "root", placesComponent: "slotsDef" },
        },
        {
            slotsDef: {
                root: "slotsRoot",
                elements: {
                    slotsRoot: { type: "nl.container", parent: null },
                    heading: { type: "nl.text", parent: "slotsRoot" },
                    slots: { type: "nl.list", parent: "slotsRoot" },
                    slot: { type: "nl.container", parent: "slots", slot: "itemTemplate" },
                },
            },
        },
    );
    const placement = buildUIComponentInstanceKey(undefined, "panel");
    const slotRow = buildUIListItemInstanceKey(placement, "slots", "3");

    it("keeps the row's widgets in the row of this placement", () => {
        expect(resolveUIWidgetAddressFromDrawing(saveScreen, "slot", slotRow)).toBe(buildUIWidgetAddress("slot", slotRow));
    });

    it("finds the definition's other widgets in the placement", () => {
        expect(resolveUIWidgetAddressFromDrawing(saveScreen, "heading", slotRow)).toBe(buildUIWidgetAddress("heading", placement));
    });
});

describe("what the rule cannot read", () => {
    it("keeps a segment it does not recognise, as every address did before", () => {
        // Something that draws its children more than once without the document saying so. The
        // element may be one of those drawings; dropping the key would be a guess.
        expect(resolveUIWidgetAddressFromDrawing(gallery, "viewer", "plugin-strip-4")).toBe(buildUIWidgetAddress("viewer", "plugin-strip-4"));
    });

    it("keeps a placement whose component the document no longer has", () => {
        const orphan = buildUIComponentInstanceKey(undefined, "gone");
        expect(resolveUIWidgetAddressFromDrawing(gallery, "viewer", orphan)).toBe(buildUIWidgetAddress("viewer", orphan));
    });
});

describe("the drawing an element is in, as seen from a row", () => {
    // What keys a widget blueprint's variables: a list answering Item Click runs in the row, but the
    // list itself is in the drawing it was placed in - the page, a placement, an outer row.
    it("is the page for a list on the page, whichever of its rows is asking", () => {
        expect(resolveUIElementDrawingKey(gallery, "grid", row)).toBeUndefined();
    });

    it("is the row for a widget of the row's template", () => {
        expect(resolveUIElementDrawingKey(gallery, "tile", row)).toBe(row);
    });

    it("is the placement for a list inside a component, and the outer row for a list inside a row", () => {
        const saveScreen = documentOf(
            {
                root: { type: "nl.root", parent: null },
                panel: { type: "nl.container", parent: "root", placesComponent: "slotsDef" },
            },
            {
                slotsDef: {
                    root: "slotsRoot",
                    elements: {
                        slotsRoot: { type: "nl.container", parent: null },
                        slots: { type: "nl.list", parent: "slotsRoot" },
                        slot: { type: "nl.container", parent: "slots", slot: "itemTemplate" },
                    },
                },
            },
        );
        const placement = buildUIComponentInstanceKey(undefined, "panel");
        expect(resolveUIElementDrawingKey(saveScreen, "slots", buildUIListItemInstanceKey(placement, "slots", "3"))).toBe(placement);

        const chapters = documentOf({
            root: { type: "nl.root", parent: null },
            chapterList: { type: "nl.list", parent: "root" },
            chapterRow: { type: "nl.container", parent: "chapterList", slot: "itemTemplate" },
            sceneList: { type: "nl.list", parent: "chapterRow" },
            sceneRow: { type: "nl.container", parent: "sceneList", slot: "itemTemplate" },
        });
        const chapterRow = buildUIListItemInstanceKey(undefined, "chapterList", "ch-1");
        expect(resolveUIElementDrawingKey(chapters, "sceneList", buildUIListItemInstanceKey(chapterRow, "sceneList", "s-3"))).toBe(chapterRow);
    });
});
