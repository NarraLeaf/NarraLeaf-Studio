import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT } from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { describeLocalizationKeyContext, indexLocalizationKeyUses, listLocalizationKeyUses } from "./localizationKeyUses";

const LAYOUT = { x: 0, y: 0, width: 10, height: 10 };

function element(input: Partial<UIElement> & { id: string; type: string }): UIElement {
    return { parentId: null, childrenIds: [], layout: LAYOUT, ...input } as UIElement;
}

const DOCUMENT = {
    surfaces: [
        { id: "title", name: "Title", kind: "appSurface", rootElementId: "root" },
        { id: "settings", name: "Settings page", kind: "appSurface", rootElementId: "settings-root" },
    ],
    elements: {
        root: element({ id: "root", type: "nl.root", childrenIds: ["start", "name", "plain", "card", "item"] }),
        "settings-root": element({ id: "settings-root", type: "nl.root" }),
        start: element({ id: "start", type: "nl.button", name: "Start", parentId: "root", props: { label: "Start", localizationKey: "menu.start" } }),
        name: element({ id: "name", type: "nl.textInput", parentId: "root", props: { placeholder: "Name", placeholderLocalizationKey: "menu.start" } }),
        plain: element({ id: "plain", type: "nl.text", name: "Plain", parentId: "root", props: { text: "Start" } }),
        // A placed component carries none of its definition's words.
        card: element({ id: "card", type: "nl.button", name: "Card", parentId: "root", props: { label: "x", localizationKey: "menu.start" }, extra: { componentLink: { componentId: "nav", linked: true } } }),
        // What a placement gives a text parameter is its own, and may name the key.
        item: element({ id: "item", type: "nl.text", name: "Item", parentId: "root", extra: { componentLink: { componentId: "nav", linked: true, paramKeys: { label: "menu.start" } } } }),
    },
    components: [
        {
            id: "nav",
            name: "Nav entry",
            rootElementId: "nav-root",
            params: [{ id: "label", name: "Caption", type: "text", defaultValue: "" }],
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

/** The same blueprints with owners, as every saved document has them, plus one the project owns. */
const OWNED_BLUEPRINTS = {
    ownerRecords: {
        "surfaceMain:title": { blueprintId: "bp-1" },
        "surfaceMain:settings": { blueprintId: "bp-2" },
        globalMain: { blueprintId: "bp-3" },
    },
    blueprints: {
        "bp-1": { ...(BLUEPRINTS.blueprints["bp-1"] as object), owner: { kind: "surfaceMain", surfaceId: "title" } },
        "bp-2": { ...(BLUEPRINTS.blueprints["bp-2"] as object), owner: { kind: "surfaceMain", surfaceId: "settings" } },
        "bp-3": {
            id: "bp-3",
            name: "App logic",
            owner: { kind: "globalMain" },
            graphs: {
                events: {
                    main: { id: "main", graph: { nodes: { g: { id: "g", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, params: { key: "menu.global" } } }, edges: [] } },
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
            { ownerName: "Title", elementName: "Item › Caption" },
            { ownerName: "Nav entry", elementName: "Label" },
        ]);
        expect(uses.blueprints).toEqual(["Title"]);
    });

    it("lists nothing for a key nothing names", () => {
        expect(listLocalizationKeyUses({ uiDocument: DOCUMENT, blueprintDocument: BLUEPRINTS, keyName: "menu.load", widgetName: () => "" }))
            .toEqual({ elements: [], blueprints: [], places: [] });
    });

    it("names the pages and components a key is used on, each once, widgets' places before blueprints'", () => {
        const uses = listLocalizationKeyUses({ uiDocument: DOCUMENT, blueprintDocument: OWNED_BLUEPRINTS, keyName: "menu.start", widgetName: () => "" });
        expect(uses.places).toEqual(["Title", "Nav entry"]);
        const quit = listLocalizationKeyUses({ uiDocument: DOCUMENT, blueprintDocument: OWNED_BLUEPRINTS, keyName: "menu.quit", widgetName: () => "" });
        expect(quit).toEqual({ elements: [], blueprints: ["Settings"], places: ["Settings page"] });
    });

    it("adds no place for a blueprint that belongs to no page or component", () => {
        const uses = listLocalizationKeyUses({ uiDocument: DOCUMENT, blueprintDocument: OWNED_BLUEPRINTS, keyName: "menu.global", widgetName: () => "" });
        expect(uses).toEqual({ elements: [], blueprints: ["App logic"], places: [] });
    });
});

describe("indexLocalizationKeyUses", () => {
    it("answers every key in one walk, the same as asking for each", () => {
        const index = indexLocalizationKeyUses({ uiDocument: DOCUMENT, blueprintDocument: OWNED_BLUEPRINTS, widgetName: entry => `(${entry.type})` });
        expect([...index.keys()].sort()).toEqual(["menu.global", "menu.quit", "menu.start"]);
        for (const keyName of index.keys()) {
            expect(index.get(keyName)).toEqual(listLocalizationKeyUses({
                uiDocument: DOCUMENT,
                blueprintDocument: OWNED_BLUEPRINTS,
                keyName,
                widgetName: entry => `(${entry.type})`,
            }));
        }
    });
});

describe("describeLocalizationKeyContext", () => {
    it("follows the key's name with the places it is used on, by name", () => {
        expect(describeLocalizationKeyContext("menu.start", { elements: [], blueprints: [], places: ["Title", "Nav entry"] }))
            .toBe("menu.start · Title, Nav entry");
    });

    it("is the key's name alone for a key nothing uses", () => {
        expect(describeLocalizationKeyContext("menu.load", undefined)).toBe("menu.load");
        expect(describeLocalizationKeyContext("menu.load", { elements: [], blueprints: ["App logic"], places: [] })).toBe("menu.load");
    });
});
