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
    it("reads a button with its own label as literal, translated through its own unit or not", () => {
        expect(buttonLabelSourceOf(button({}), true)).toBe("literal");
        expect(buttonLabelSourceOf(button({ localizable: true }), true)).toBe("literal");
        expect(buttonLabelSourceOf(button({}, TEXT_BINDING), true)).toBe("literal");
    });

    it("reads a button with both its own label and a key as keyed, which is what the game shows", () => {
        expect(buttonLabelSourceOf(button({ localizationKey: "config.skipAllText" }), true)).toBe("key");
    });

    it("puts a key before a Blueprint Value, in the order the game resolves them", () => {
        expect(buttonLabelSourceOf(button({ localizationKey: "config.skipAllText" }, BLUEPRINT), true)).toBe("key");
        expect(buttonLabelSourceOf(button({}, BLUEPRINT), true)).toBe("blueprint");
    });

    it("ignores a key while the project carries none, as a build does", () => {
        expect(buttonLabelSourceOf(button({ localizationKey: "config.skipAllText" }), false)).toBe("literal");
    });

    it("offers none of the three for a list row's button bound to a field of the row", () => {
        expect(buttonLabelSourceOf(button({}, FIELD), true)).toBeNull();
    });
});
