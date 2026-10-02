import { describe, expect, it } from "vitest";
import { initialConditionOperator, listedConditionOperators } from "./ConditionEditor";

/**
 * Which operators the condition picker lists for a variable.
 *
 * A boolean used to be offered five tests - on, off, equals, does not equal, is set - for a value that
 * has two answers, so "equals" beside "is true" asked the same question twice. And "is true" was
 * offered for numbers and strings, where it compares against the boolean itself and so can only ever
 * answer no.
 */
describe("listedConditionOperators", () => {
    it("offers a boolean its two answers and the empty state, nothing that compares", () => {
        expect(listedConditionOperators("boolean", "isTrue")).toEqual(["isTrue", "isFalse", "exists"]);
    });

    it("compares numbers and strings against a value, with thresholds, and never asks if they are true", () => {
        const ordered = ["equals", "notEquals", "greaterThan", "greaterOrEqual", "lessThan", "lessOrEqual", "exists"];
        expect(listedConditionOperators("number", "equals")).toEqual(ordered);
        expect(listedConditionOperators("string", "equals")).toEqual(ordered);
    });

    it("compares json by shape only", () => {
        expect(listedConditionOperators("json", "equals")).toEqual(["equals", "notEquals", "exists"]);
    });

    /**
     * Documents carry operators the picker no longer offers for their type - every boolean branch built
     * with "equals" before this. The dropdown has to show what is stored, in its usual place, or it
     * reads as empty; the condition itself runs as it always did.
     */
    it("keeps listing a stored operator the type no longer offers", () => {
        expect(listedConditionOperators("boolean", "equals")).toEqual(["isTrue", "isFalse", "equals", "exists"]);
        expect(listedConditionOperators("number", "isTrue")).toContain("isTrue");
        expect(listedConditionOperators("json", "greaterThan")).toEqual(["equals", "notEquals", "greaterThan", "exists"]);
    });

    it("lists everything when the variable is unknown", () => {
        expect(listedConditionOperators(undefined, "isTrue")).toHaveLength(9);
    });
});

describe("initialConditionOperator", () => {
    it("starts a boolean on its first answer and every other type on a comparison", () => {
        expect(initialConditionOperator("boolean")).toBe("isTrue");
        expect(initialConditionOperator("number")).toBe("equals");
        expect(initialConditionOperator("string")).toBe("equals");
        expect(initialConditionOperator("json")).toBe("equals");
    });
});
