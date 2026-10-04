import { describe, expect, it } from "vitest";
import type { UIComponentDefinition, UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { EMPTY_UI_TEXT_WRITER_INDEX, type UITextWriter } from "@shared/types/ui-editor/textWriters";
import { extractUITextEntries, type UITextExtractionInput } from "./uiTextSource";

/**
 * Interface words are found where the canvas shows them: a widget's own words, the source words of a
 * key a widget names, and what a component placement gives a text parameter - each opening the page or
 * the component with that widget selected. Sample text is found too, and says it is sample text.
 */

const layout = { x: 0, y: 0, width: 10, height: 10 };

function element(id: string, type: string, more: Partial<UIElement> = {}): UIElement {
    return { id, type, parentId: "root", childrenIds: [], layout, ...more };
}

const nav: UIComponentDefinition = {
    id: "nav",
    name: "Nav item",
    rootElementId: "nav-root",
    params: [{ id: "label", name: "Label", type: "text", defaultValue: "Item" }],
    elements: {
        "nav-root": element("nav-root", "nl.container", { parentId: null, childrenIds: ["nav-label", "nav-hint"] }),
        "nav-label": element("nav-label", "nl.text", {
            parentId: "nav-root",
            name: "Label",
            props: { text: "Sample" },
            valueBindings: { text: { kind: "componentParam", paramId: "label" } },
        }),
        "nav-hint": element("nav-hint", "nl.text", { parentId: "nav-root", name: "Hint", props: { text: "Press to go" } }),
    },
};

const children = ["title", "start", "lost", "unnamed", "bound", "written", "sentence", "blank", "p1", "p2"];

const document = {
    schemaVersion: 13,
    surfaces: [{ id: "page-title", name: "Title", kind: "appSurface", rootElementId: "root" }],
    elements: {
        root: element("root", "nl.root", { parentId: null, childrenIds: children }),
        title: element("title", "nl.text", { name: "Game title", props: { text: "Your Game" } }),
        start: element("start", "nl.button", { name: "Start", props: { localizationKey: "menu.start" } }),
        lost: element("lost", "nl.button", { name: "Lost", props: { localizationKey: "menu.gone" } }),
        unnamed: element("unnamed", "nl.button", { props: { label: "Begin the adventure" } }),
        bound: element("bound", "nl.text", {
            name: "Name tag",
            props: { text: "Narra" },
            valueBindings: { text: { kind: "blueprintValue", blueprintId: "bp", valueType: "string" } },
        }),
        written: element("written", "nl.text", { name: "Place", props: { text: "Corridor" } }),
        sentence: element("sentence", "nl.dialog.sentence", { name: "Line", props: { text: "The current line" } }),
        blank: element("blank", "nl.text", { name: "Blank", props: { text: "   " } }),
        p1: element("p1", "nl.container", {
            name: "Nav 1",
            props: { text: "Instance copy" },
            extra: { componentLink: { componentId: "nav", linked: true, params: { label: "Begin" } } },
        }),
        p2: element("p2", "nl.container", {
            name: "Nav 2",
            extra: { componentLink: { componentId: "nav", linked: true, paramKeys: { label: "menu.start" } } },
        }),
    },
    components: [nav],
} as unknown as UIDocument;

const writer: UITextWriter = {
    blueprintId: "bp-w",
    graphKind: "event",
    graphId: "g",
    nodeId: "n",
    nodeType: "blueprint.text.set",
    effect: "replace",
    textProp: "text",
} as UITextWriter;

const input: UITextExtractionInput = {
    keys: { "menu.start": "Start Game" },
    writers: new Map([["written", [writer]]]),
    labels: { sample: "Sample text", widgetName: el => (el.type === "nl.button" ? "Button" : "Widget") },
};

function byId(id: string) {
    return extractUITextEntries(document, input).find(entry => entry.id === id);
}

describe("extractUITextEntries", () => {
    it("finds a widget's own words and opens its page with it selected", () => {
        expect(byId("uitext:title.text")).toEqual({
            id: "uitext:title.text",
            group: "uiText",
            text: "Your Game",
            detail: "Title › Game title",
            target: { kind: "uiSurface", surfaceId: "page-title", elementId: "title" },
        });
    });

    it("finds a keyed widget by the key's source words, and one naming a missing key by the key's name", () => {
        expect(byId("uitext:start.label")).toMatchObject({ text: "Start Game", detail: "Title › Start" });
        expect(byId("uitext:lost.label")).toMatchObject({ text: "menu.gone" });
    });

    it("calls a widget the author never named by its kind, never by its id", () => {
        expect(byId("uitext:unnamed.label")).toMatchObject({ text: "Begin the adventure", detail: "Title › Button" });
    });

    it("lists sample text with a note saying so", () => {
        expect(byId("uitext:bound.text")?.detail).toBe("Title › Name tag · Sample text");
        expect(byId("uitext:written.text")?.detail).toBe("Title › Place · Sample text");
        expect(byId("uitext:sentence.text")?.detail).toBe("Title › Line · Sample text");
        expect(byId("uitext:title.text")?.detail).not.toContain("Sample text");
    });

    it("decides sample text by who writes over the words", () => {
        const entries = extractUITextEntries(document, { ...input, writers: EMPTY_UI_TEXT_WRITER_INDEX });
        expect(entries.find(entry => entry.id === "uitext:written.text")?.detail).toBe("Title › Place");
    });

    it("skips words with nothing to find", () => {
        expect(byId("uitext:blank.text")).toBeUndefined();
    });

    it("finds what a placement gives a text parameter, under the placement, and never the placement's own copy", () => {
        expect(byId("uitext:p1.param.label")).toMatchObject({
            text: "Begin",
            detail: "Title › Nav 1 › Label",
            target: { kind: "uiSurface", surfaceId: "page-title", elementId: "p1" },
        });
        expect(byId("uitext:p2.param.label")).toMatchObject({ text: "Start Game" });
        expect(extractUITextEntries(document, input).some(entry => entry.text === "Instance copy")).toBe(false);
    });

    it("finds a component's own words and opens the component with the widget selected", () => {
        expect(byId("uitext:nav-hint.text")).toMatchObject({
            text: "Press to go",
            detail: "Nav item › Hint",
            target: { kind: "uiComponent", componentId: "nav", elementId: "nav-hint" },
        });
        expect(byId("uitext:nav-label.text")?.detail).toBe("Nav item › Label · Sample text");
    });

    it("reads keyed widgets as the canvas does before the keys have loaded", () => {
        const entries = extractUITextEntries(document, { ...input, keys: null });
        expect(entries.find(entry => entry.id === "uitext:start.label")).toBeUndefined();
        expect(entries.find(entry => entry.id === "uitext:title.text")).toBeDefined();
    });
});
