import { describe, expect, it } from "vitest";
import type { UIComponentDefinition, UIElement } from "./document";
import {
    listUIComponentDefaultUnits,
    listUITextOwnUnits,
    mapCopiedUIComponentDefaultUnits,
    mapCopiedUITextUnits,
} from "./textUnitCopies";

/** The units a copy brings translations for: the words its elements write directly, and nothing else. */

function element(id: string, type: string, more: Partial<UIElement> = {}): UIElement {
    return { id, type, parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 10, height: 10 }, ...more };
}

const table: Record<string, UIElement> = {
    words: element("words", "nl.button", { props: { label: "Begin" } }),
    keyed: element("keyed", "nl.button", { props: { localizationKey: "menu.start" } }),
    hint: element("hint", "nl.textInput", { props: { placeholder: "Your name" } }),
    line: element("line", "nl.dialog.sentence", { props: { text: "The current line" } }),
    box: element("box", "nl.container"),
    placement: element("placement", "nl.container", {
        props: { text: "Copy of the definition's words" },
        extra: { componentLink: { componentId: "nav", linked: true, params: { label: "Start", target: "title" }, paramKeys: { caption: "menu.start" } } },
    }),
};

describe("listUITextOwnUnits", () => {
    it("lists the words elements write directly on sites a player reads, and a placement's written parameter values", () => {
        expect(listUITextOwnUnits(table)).toEqual([
            { elementId: "words", prop: "label", unitId: "ui:words.label" },
            { elementId: "hint", prop: "placeholder", unitId: "ui:hint.placeholder" },
            { elementId: "placement", prop: "param.label", unitId: "ui:placement.param.label" },
            { elementId: "placement", prop: "param.target", unitId: "ui:placement.param.target" },
        ]);
    });
});

describe("mapCopiedUITextUnits", () => {
    it("re-keys each unit onto the copy's id, leaving out sites that took a key's words", () => {
        const units = mapCopiedUITextUnits(table, { words: "w2", hint: "h2", placement: "p2" }, [{ elementId: "hint", prop: "placeholder" }]);
        expect([...units]).toEqual([
            ["ui:words.label", "ui:w2.label"],
            ["ui:placement.param.label", "ui:p2.param.label"],
            ["ui:placement.param.target", "ui:p2.param.target"],
        ]);
    });

    it("maps nothing for an element that was not copied", () => {
        expect(mapCopiedUITextUnits(table, {}).size).toBe(0);
    });
});

describe("component parameter defaults", () => {
    const nav = {
        id: "nav",
        params: [
            { id: "label", name: "Label", type: "text", defaultValue: "Item" },
            { id: "target", name: "Target", type: "string", defaultValue: "title" },
        ],
    } as Pick<UIComponentDefinition, "id" | "params">;

    it("lists the units of text parameters only", () => {
        expect(listUIComponentDefaultUnits(nav)).toEqual(["ui:nav.param.label"]);
    });

    it("re-keys them onto a copied definition", () => {
        expect([...mapCopiedUIComponentDefaultUnits([nav], { nav: "nav-copy" })]).toEqual([["ui:nav.param.label", "ui:nav-copy.param.label"]]);
    });
});
