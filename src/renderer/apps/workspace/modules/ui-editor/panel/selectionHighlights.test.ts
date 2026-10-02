import { describe, expect, it } from "vitest";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import {
    answeredActionIdsForSelection,
    linkedComponentIdsForSelection,
    sameIdSet,
    scrollRowIntoListView,
    selectionSurfaceId,
} from "./selectionHighlights";

function element(id: string, componentId?: string): UIElement {
    return {
        id,
        type: "nl.container",
        parentId: null,
        childrenIds: [],
        extra: componentId ? { componentLink: { linked: true, componentId, params: {} } } : {},
    } as unknown as UIElement;
}

/**
 * A page with two save-slot instances, a title-button instance and a plain text; a Game UI that
 * answers two actions; and a component whose own tree holds an instance of another component.
 */
const DOCUMENT = {
    surfaces: [
        { id: "load", kind: "appSurface", actions: [{ actionId: "dismiss" }] },
        { id: "dialogue", kind: "stageSurface", actions: [{ actionId: "advance" }, { actionId: "backlog" }] },
        { id: "title", kind: "appSurface" },
    ],
    elements: {
        slot1: element("slot1", "saveSlot"),
        slot2: element("slot2", "saveSlot"),
        back: element("back", "titleButton"),
        heading: element("heading"),
    },
    components: [
        {
            id: "menu",
            name: "Menu",
            rootElementId: "menu-root",
            elements: { "menu-root": element("menu-root"), "menu-item": element("menu-item", "titleButton") },
        },
    ],
} as unknown as UIDocument;

function elements(surfaceId: string, ...elementIds: string[]): SelectionState {
    return { type: "element", data: { editor: "ui", surfaceId, elementIds, primaryId: elementIds[0] } };
}

describe("linkedComponentIdsForSelection", () => {
    it("answers the components behind the selected instances, once each", () => {
        expect([...linkedComponentIdsForSelection(elements("load", "slot1", "slot2", "back"), DOCUMENT)])
            .toEqual(["saveSlot", "titleButton"]);
    });

    it("answers nothing for an element that is not an instance", () => {
        expect(linkedComponentIdsForSelection(elements("load", "heading"), DOCUMENT).size).toBe(0);
    });

    it("answers nothing once the selection goes back to the interface itself", () => {
        expect(linkedComponentIdsForSelection({ type: "scene", data: "load" }, DOCUMENT).size).toBe(0);
        expect(linkedComponentIdsForSelection({ type: null, data: null }, DOCUMENT).size).toBe(0);
    });

    it("reads an instance placed inside a component from that component's own tree", () => {
        expect([...linkedComponentIdsForSelection(elements("component-editor:menu", "menu-item"), DOCUMENT)])
            .toEqual(["titleButton"]);
    });
});

describe("answeredActionIdsForSelection", () => {
    it("is the answered list of the interface being looked at, whatever on it is selected", () => {
        expect([...answeredActionIdsForSelection({ type: "scene", data: "dialogue" }, DOCUMENT)])
            .toEqual(["advance", "backlog"]);
        expect([...answeredActionIdsForSelection(elements("load", "heading"), DOCUMENT)]).toEqual(["dismiss"]);
        expect([...answeredActionIdsForSelection(elements("load", "slot1"), DOCUMENT)]).toEqual(["dismiss"]);
    });

    it("answers nothing for an interface that answers nothing, or for a component editor", () => {
        expect(answeredActionIdsForSelection({ type: "scene", data: "title" }, DOCUMENT).size).toBe(0);
        expect(answeredActionIdsForSelection({ type: "scene", data: "component-editor:menu" }, DOCUMENT).size).toBe(0);
        expect(answeredActionIdsForSelection({ type: null, data: null }, DOCUMENT).size).toBe(0);
    });

    it("names the surface an element selection is on", () => {
        expect(selectionSurfaceId(elements("dialogue", "x"))).toBe("dialogue");
        expect(selectionSurfaceId({ type: null, data: null })).toBeNull();
    });
});

describe("sameIdSet", () => {
    it("compares contents, not identity", () => {
        expect(sameIdSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
        expect(sameIdSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
        expect(sameIdSet(new Set(["a"]), new Set(["b"]))).toBe(false);
    });
});

describe("scrollRowIntoListView", () => {
    function boxes(list: { top: number; bottom: number }, row: { top: number; bottom: number }) {
        const listElement = {
            scrollTop: 100,
            getBoundingClientRect: () => list,
        } as unknown as HTMLElement;
        const rowElement = { getBoundingClientRect: () => row } as unknown as HTMLElement;
        return { listElement, rowElement };
    }

    it("leaves a row that is already in view where it is", () => {
        const { listElement, rowElement } = boxes({ top: 0, bottom: 200 }, { top: 20, bottom: 80 });
        scrollRowIntoListView(listElement, rowElement);
        expect(listElement.scrollTop).toBe(100);
    });

    it("scrolls up to a row above the list, and down to one below it", () => {
        const above = boxes({ top: 0, bottom: 200 }, { top: -50, bottom: 10 });
        scrollRowIntoListView(above.listElement, above.rowElement);
        expect(above.listElement.scrollTop).toBe(50);

        const below = boxes({ top: 0, bottom: 200 }, { top: 180, bottom: 240 });
        scrollRowIntoListView(below.listElement, below.rowElement);
        expect(below.listElement.scrollTop).toBe(140);
    });

    it("shows the top of a row taller than the list", () => {
        const { listElement, rowElement } = boxes({ top: 0, bottom: 100 }, { top: 60, bottom: 300 });
        scrollRowIntoListView(listElement, rowElement);
        expect(listElement.scrollTop).toBe(160);
    });
});
