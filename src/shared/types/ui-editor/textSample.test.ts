import { describe, expect, it } from "vitest";
import type { UIElement } from "./document";
import { uiTextSampleCauseOf } from "./textSample";
import { requireUITextSite } from "./textSource";
import type { UITextWriter } from "./textWriters";

/**
 * Sample text: which words a player never reads.
 */

const TEXT = requireUITextSite("nl.text");
const BUTTON = requireUITextSite("nl.button");

function element(id: string, type: string, props: Record<string, unknown>, valueBindings?: UIElement["valueBindings"]): UIElement {
    return {
        id,
        type,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 } as UIElement["layout"],
        props,
        ...(valueBindings ? { valueBindings } : {}),
    };
}

function writer(effect: UITextWriter["effect"], textProp: UITextWriter["textProp"] = "text"): UITextWriter {
    return { blueprintId: "bp", graphKind: "event", graphId: "g", nodeId: "n", nodeType: "t", effect, textProp };
}

const BOUND = { text: { kind: "blueprintValue" as const, blueprintId: "bp-name", valueType: "string" as const } };

describe("uiTextSampleCauseOf", () => {
    it("calls the words under a value blueprint or a row field sample", () => {
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Narra" }, BOUND), TEXT, undefined)).toBe("blueprintValue");
        expect(uiTextSampleCauseOf(
            element("a", "nl.text", { text: "Narra" }, { text: { kind: "listItemField", fieldId: "name" } }),
            TEXT,
            undefined,
        )).toBe("listItemField");
    });

    it("calls the words a blueprint replaces sample, and keeps the words it only appends to", () => {
        const place = element("place", "nl.text", { text: "The corridor" });
        expect(uiTextSampleCauseOf(place, TEXT, [writer("replace")])).toBe("written");
        expect(uiTextSampleCauseOf(place, TEXT, [writer("append")])).toBeNull();
        expect(uiTextSampleCauseOf(place, TEXT, [writer("append"), writer("replace")])).toBe("written");
        expect(uiTextSampleCauseOf(element("b", "nl.button", { label: "Off" }), BUTTON, [writer("replace", "label")])).toBe("written");
    });

    it("leaves a keyed element's words alone, and the words a player reads", () => {
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start", localizationKey: "menu.start" }, BOUND), TEXT, [writer("replace")])).toBeNull();
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start" }), TEXT, undefined)).toBeNull();
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start" }), TEXT, [])).toBeNull();
    });

    it("is not asked about the dialogue line, whose site says it has sample words", () => {
        const sentence = requireUITextSite("nl.dialog.sentence");
        expect(uiTextSampleCauseOf(element("s", "nl.dialog.sentence", { text: "A line" }, BOUND), sentence, [writer("replace")])).toBeNull();
    });
});
