import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { textSourceOf } from "./helpers";

function text(props: Record<string, unknown>, valueBindings?: UIElement["valueBindings"]): UIElement {
    return {
        id: "t",
        type: "nl.text",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        props: { text: "Own words", ...props },
        ...(valueBindings ? { valueBindings } : {}),
    } as UIElement;
}

const BLUEPRINT = { text: { kind: "blueprintValue", blueprintId: "bp", valueType: "string" } } as UIElement["valueBindings"];
const FIELD = { text: { kind: "listItemField", fieldId: "name" } } as UIElement["valueBindings"];

describe("textSourceOf", () => {
    it("reads an element with its own words as literal, translated through its own unit or not", () => {
        expect(textSourceOf(text({}), true)).toBe("literal");
        expect(textSourceOf(text({ localizable: true }), true)).toBe("literal");
    });

    it("reads an element with both its own words and a key as keyed, which is what the game shows", () => {
        expect(textSourceOf(text({ localizationKey: "config.title" }), true)).toBe("key");
    });

    it("puts a key before a Blueprint Value, in the order the game resolves them", () => {
        expect(textSourceOf(text({ localizationKey: "config.title" }, BLUEPRINT), true)).toBe("key");
        expect(textSourceOf(text({}, BLUEPRINT), true)).toBe("blueprint");
    });

    it("ignores a key while the project carries none, as a build does", () => {
        expect(textSourceOf(text({ localizationKey: "config.title" }), false)).toBe("literal");
        expect(textSourceOf(text({ localizationKey: "config.title" }, BLUEPRINT), false)).toBe("blueprint");
    });

    it("ignores a blank key", () => {
        expect(textSourceOf(text({ localizationKey: "  " }), true)).toBe("literal");
    });

    it("offers none of the three for a list row's text bound to a field of the row", () => {
        expect(textSourceOf(text({}, FIELD), true)).toBeNull();
    });
});
