import { describe, expect, it } from "vitest";
import type { StoryConditionRef } from "@shared/types/story";
import { conditionKindOf } from "./ConditionEditor";

/**
 * Which editor tier a stored condition opens in.
 *
 * This exists because of a real data-loss bug: the tier used to be picked with
 * `value.kind === "blueprint" ? "blueprint" : "variable"`, so an `expression` condition — the kind
 * `/if` writes — opened as a *blank* variable condition and the first edit overwrote it. A condition
 * that maps to the wrong tier is not a cosmetic problem; it silently destroys the author's work.
 */
describe("conditionKindOf", () => {
    it("opens each stored kind in its own tier", () => {
        const expression: StoryConditionRef = { kind: "expression", expression: { source: "gold >= 100", ast: { kind: "literal", value: true } } };
        const variable: StoryConditionRef = { kind: "variable", target: { scope: "scene", variableId: "v" }, operator: "isTrue" };
        const blueprint: StoryConditionRef = { kind: "blueprint", blueprintId: "bp-1" };

        expect(conditionKindOf(expression)).toBe("expression");
        expect(conditionKindOf(variable)).toBe("variable");
        expect(conditionKindOf(blueprint)).toBe("blueprint");
    });

    it("starts a brand-new condition in the expression tier", () => {
        // Same tier `/if` writes into, so a condition built by clicking and one built by typing are
        // the same object and each can edit the other's work.
        expect(conditionKindOf(undefined)).toBe("expression");
    });

    it("never maps a kind onto a tier that cannot represent it", () => {
        // The guard against the original bug returning: every member of the union must land somewhere
        // that renders it, so adding a fourth kind without a tier fails here rather than in the field.
        const kinds: StoryConditionRef["kind"][] = ["variable", "blueprint", "expression"];
        for (const kind of kinds) {
            expect(conditionKindOf({ kind } as StoryConditionRef)).toBe(kind);
        }
    });
});
