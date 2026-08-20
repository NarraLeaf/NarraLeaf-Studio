import { describe, expect, it } from "vitest";
import {
    WIDGET_TYPE_PARENTS,
    getWidgetTypeAncestors,
    getWidgetTypeChain,
    getWidgetTypeParent,
    isWidgetTypeOf,
    listWidgetTypesOf,
    resolveByWidgetType,
    walkWidgetTypeChain,
} from "./widgetInheritance";
import { getSupportedEffectKindsForWidgetType } from "./effects";
import { getWidgetLogicApi } from "./widgetLogic";
import { UI_LIST_LIKE_WIDGET_TYPES, isListLikeWidgetType } from "./list";

describe("widget type inheritance", () => {
    it("reports the chain nearest first", () => {
        expect(getWidgetTypeChain("nl.dialog.sentence")).toEqual(["nl.dialog.sentence", "nl.text"]);
        expect(getWidgetTypeAncestors("nl.dialog.sentence")).toEqual(["nl.text"]);
        expect(getWidgetTypeChain("nl.text")).toEqual(["nl.text"]);
        expect(getWidgetTypeChain(undefined)).toEqual([]);
        expect(getWidgetTypeParent("nl.text")).toBeUndefined();
    });

    it("answers assignability for a type and its specialisations", () => {
        expect(isWidgetTypeOf("nl.text", "nl.text")).toBe(true);
        expect(isWidgetTypeOf("nl.nvl.texts", "nl.text")).toBe(true);
        expect(isWidgetTypeOf("nl.button", "nl.text")).toBe(false);
        expect(isWidgetTypeOf(null, "nl.text")).toBe(false);
    });

    it("resolves a type-keyed table through the chain", () => {
        const table = { "nl.text": "text", "nl.choice.list": "choices" };
        expect(resolveByWidgetType(table, "nl.text")).toBe("text");
        expect(resolveByWidgetType(table, "nl.dialog.sentence")).toBe("text");
        expect(resolveByWidgetType(table, "nl.choice.list")).toBe("choices");
        expect(resolveByWidgetType(table, "nl.container")).toBeUndefined();
    });

    it("terminates on a cyclic table", () => {
        expect(walkWidgetTypeChain({ a: "b", b: "a" }, "a")).toEqual(["a", "b"]);
    });

    it("declares no cycle of its own", () => {
        for (const type of Object.keys(WIDGET_TYPE_PARENTS)) {
            const chain = getWidgetTypeChain(type);
            expect(new Set(chain).size).toBe(chain.length);
        }
    });

    it("lists a family from the table", () => {
        expect(listWidgetTypesOf("nl.text")).toEqual(["nl.text", "nl.dialog.sentence", "nl.nvl.texts"]);
        expect(UI_LIST_LIKE_WIDGET_TYPES).toEqual([
            "nl.list",
            "nl.notification.list",
            "nl.choice.list",
            "nl.nvl.list",
        ]);
        expect(isListLikeWidgetType("nl.nvl.list")).toBe(true);
        expect(isListLikeWidgetType("nl.text")).toBe(false);
    });

    it("keeps the capability tables answering for every specialisation", () => {
        // These were four and five hand-copied rows before the table existed; the point of the
        // fallback is that they still answer without them.
        for (const type of listWidgetTypesOf("nl.text")) {
            expect(getSupportedEffectKindsForWidgetType(type)).toEqual([
                "blur",
                "textShadow",
                "blend",
                "filter",
            ]);
        }
        for (const type of listWidgetTypesOf("nl.list")) {
            expect(getSupportedEffectKindsForWidgetType(type)).toContain("backgroundBlur");
        }
        // A specialisation still gets its own label where it declares one.
        expect(getWidgetLogicApi("nl.dialog.sentence")?.blueprintLabel).toBe("Sentence logic");
        expect(getWidgetLogicApi("nl.text")?.writableProps).toEqual(
            getWidgetLogicApi("nl.dialog.sentence")?.writableProps,
        );
    });
});
