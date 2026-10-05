import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { buttonLabelSourceOf } from "./helpers";

function button(props: Record<string, unknown>, valueBindings?: UIElement["valueBindings"]): UIElement {
    return {
        id: "b",
        type: "nl.button",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props: { label: "Own label", ...props },
        ...(valueBindings ? { valueBindings } : {}),
    } as UIElement;
}

const BLUEPRINT = { label: { kind: "blueprintValue", blueprintId: "bp", valueType: "string" } } as UIElement["valueBindings"];
const FIELD = { label: { kind: "listItemField", fieldId: "name" } } as UIElement["valueBindings"];
// A binding on another prop says nothing about where the label comes from.
const TEXT_BINDING = { text: { kind: "blueprintValue", blueprintId: "bp", valueType: "string" } } as UIElement["valueBindings"];

describe("buttonLabelSourceOf", () => {
    it("reads a button with its own label as literal", () => {
        expect(buttonLabelSourceOf(button({}))).toBe("literal");
        expect(buttonLabelSourceOf(button({}, TEXT_BINDING))).toBe("literal");
    });

    it("reads a button with a key as keyed, whether or not the project has a source language", () => {
        expect(buttonLabelSourceOf(button({ localizationKey: "config.skipAllText" }))).toBe("key");
    });

    it("puts a key before a Blueprint Value, in the order the game resolves them", () => {
        expect(buttonLabelSourceOf(button({ localizationKey: "config.skipAllText" }, BLUEPRINT))).toBe("key");
        expect(buttonLabelSourceOf(button({}, BLUEPRINT))).toBe("blueprint");
    });

    it("offers none of the three for a list row's button bound to a field of the row", () => {
        expect(buttonLabelSourceOf(button({}, FIELD))).toBeNull();
    });
});
