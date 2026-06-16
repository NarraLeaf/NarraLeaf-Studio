import { describe, expect, it } from "vitest";
import type { BlueprintField } from "@shared/types/blueprint/document";
import { evaluateFieldValue, type BlueprintStateReader } from "./fieldEvaluation";

const emptyState: BlueprintStateReader = {
    get: () => undefined,
};

function field(valueSource: BlueprintField["valueSource"]): BlueprintField {
    return {
        id: "field",
        name: "Field",
        valueSource,
    };
}

describe("evaluateFieldValue", () => {
    it("reads list item paths from the active list item scope", () => {
        expect(
            evaluateFieldValue(
                field({ kind: "listItem", path: "label.text" }),
                emptyState,
                undefined,
                { item: { label: { text: "Start" } }, index: 2, count: 5, key: "row-2" },
            ),
        ).toBe("Start");
    });

    it("reads list index and count from the active list item scope", () => {
        const scope = { item: {}, index: 3, count: 8, key: "row-3" };

        expect(evaluateFieldValue(field({ kind: "listIndex" }), emptyState, undefined, scope)).toBe(3);
        expect(evaluateFieldValue(field({ kind: "listCount" }), emptyState, undefined, scope)).toBe(8);
    });
});

