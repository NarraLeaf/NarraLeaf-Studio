import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT } from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { listLocalizationKeyUses } from "./localizationKeyUses";

const LAYOUT = { x: 0, y: 0, width: 10, height: 10 };

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
    return { parentId: null, childrenIds: [], layout: LAYOUT, ...input } as UIElement;
}

const DOCUMENT = {
    surfaces: [{ id: "title", name: "Title", kind: "appSurface", rootElementId: "root" }],
    elements: {
        root: element({ id: "root", type: "nl.root", childrenIds: ["start", "name", "plain", "card"] }),
        start: element({ id: "start", type: "nl.button", name: "Start", parentId: "root", props: { label: "Start", localizationKey: "menu.start" } }),
        name: element({ id: "name", type: "nl.textInput", parentId: "root", props: { placeholder: "Name", placeholderLocalizationKey: "menu.start" } }),
        plain: element({ id: "plain", type: "nl.text", name: "Plain", parentId: "root", props: { text: "Start" } }),
        // A placed component carries none of its definition's words.
        card: element({ id: "card", type: "nl.button", name: "Card", parentId: "root", props: { label: "x", localizationKey: "menu.start" }, extra: { componentLink: { componentId: "nav", linked: true } } }),
    },
    components: [
        {
            id: "nav",
            name: "Nav entry",
            rootElementId: "nav-root",
            elements: {
                "nav-root": element({ id: "nav-root", type: "nl.text", name: "Label", props: { text: "Start", localizationKey: "menu.start" } }),
            },
        },
    ],
} as unknown as UIDocument;

const BLUEPRINTS = {
    ownerRecords: { "surface:title": { blueprintId: "bp-1" }, "surface:other": { blueprintId: "bp-2" } },
    blueprints: {
        "bp-1": {
            id: "bp-1",
            name: "Title",
            graphs: {
                events: {
                    main: { id: "main", graph: { nodes: { g: { id: "g", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, params: { key: "menu.start" } } }, edges: [] } },
                },
                functions: {},
            },
        },
        "bp-2": {
            id: "bp-2",
            name: "Settings",
            graphs: {
                events: {
                    main: { id: "main", graph: { nodes: { g: { id: "g", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, params: { key: "menu.quit" } } }, edges: [] } },
                },
                functions: {},
            },
        },
    },
} as unknown as BlueprintDocument;

describe("listLocalizationKeyUses", () => {
    it("lists every widget and blueprint naming the key, by the names an author sees", () => {
        const uses = listLocalizationKeyUses({
            uiDocument: DOCUMENT,
            blueprintDocument: BLUEPRINTS,
            keyName: "menu.start",
            widgetName: entry => `(${entry.type})`,
        });
        expect(uses.elements).toEqual([
            { ownerName: "Title", elementName: "Start" },
            { ownerName: "Title", elementName: "(nl.textInput)" },
            { ownerName: "Nav entry", elementName: "Label" },
        ]);
        expect(uses.blueprints).toEqual(["Title"]);
    });

    it("lists nothing for a key nothing names", () => {
        expect(listLocalizationKeyUses({ uiDocument: DOCUMENT, blueprintDocument: BLUEPRINTS, keyName: "menu.load", widgetName: () => "" }))
            .toEqual({ elements: [], blueprints: [] });
    });
});
