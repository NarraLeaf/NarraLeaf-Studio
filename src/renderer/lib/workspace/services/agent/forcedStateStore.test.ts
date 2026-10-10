import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { ForcedStateStore, forcedStateElementIds } from "./forcedStateStore";

/**
 * `ui_screenshot`'s `state`: the chosen element and what is drawn inside it answer "yes" for the
 * state, however the drawing keys them; every other element keeps its own signals.
 */

function element(id: string, parentId: string | null, childrenIds: string[] = [], extra?: Record<string, unknown>): UIElement {
    return { id, type: "nl.container", name: id, parentId, childrenIds, layout: { x: 0, y: 0, width: 10, height: 10 }, ...(extra ? { extra } : {}) };
}

const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    surfaces: [],
    elements: {
        root: element("root", null, ["button", "other"]),
        button: element("button", "root", ["label", "placed"]),
        label: element("label", "button"),
        placed: element("placed", "button", [], { componentLink: { componentId: "badge", linked: true } }),
        other: element("other", "root"),
    },
    components: [{ id: "badge", name: "Badge", rootElementId: "badgeRoot", elements: { badgeRoot: element("badgeRoot", null, ["badgeText"]), badgeText: element("badgeText", "badgeRoot") } }],
    meta: {},
} as unknown as UIDocument;

describe("ForcedStateStore", () => {
    it("covers the element, its children and the insides of components placed in it", () => {
        expect([...forcedStateElementIds(document, document.elements, "button")].sort())
            .toEqual(["badgeRoot", "badgeText", "button", "label", "placed"]);
    });

    it("forces the state on every key spelling that names a covered element, and on nothing else", () => {
        const store = new ForcedStateStore(forcedStateElementIds(document, document.elements, "button"), "hovered");
        expect(store.getSignalsForElement("button", false).hovered).toBe(true);
        expect(store.getSignalsForElement("surface\0label", false).hovered).toBe(true);
        expect(store.getSignalsForElement("surface\0badgeText\0row-2", false).hovered).toBe(true);
        expect(store.getSignalsForElement("surface\0other", false).hovered).toBe(false);
        const pressed = new ForcedStateStore(new Set(["button"]), "active");
        expect(pressed.getSignalsForElement("button", false)).toMatchObject({ active: true, hovered: false, disabled: false });
    });
});
