import { describe, expect, it } from "vitest";
import { arrowKeyStep, evaluateNumericInput, stepNumber } from "./numericExpression";

describe("evaluateNumericInput", () => {
    it("reads plain numbers, signs and decimals", () => {
        expect(evaluateNumericInput("120")).toBe(120);
        expect(evaluateNumericInput("-8.5")).toBe(-8.5);
        expect(evaluateNumericInput(".5")).toBe(0.5);
        expect(evaluateNumericInput("  42 ")).toBe(42);
    });

    it("does arithmetic with precedence and brackets", () => {
        expect(evaluateNumericInput("120+16")).toBe(136);
        expect(evaluateNumericInput("1920/3")).toBe(640);
        expect(evaluateNumericInput("(40-8)*2")).toBe(64);
        expect(evaluateNumericInput("10+2*3")).toBe(16);
        expect(evaluateNumericInput("100 - -20")).toBe(120);
    });

    it("reads past a trailing unit, as the fields always did", () => {
        expect(evaluateNumericInput("12px")).toBe(12);
        expect(evaluateNumericInput("50%")).toBe(50);
    });

    it("is not a number for anything else, rather than half of it", () => {
        expect(evaluateNumericInput("")).toBeNull();
        expect(evaluateNumericInput("-")).toBeNull();
        expect(evaluateNumericInput("10+")).toBeNull();
        expect(evaluateNumericInput("abc")).toBeNull();
        expect(evaluateNumericInput("1/0")).toBeNull();
        expect(evaluateNumericInput("(1+2")).toBeNull();
    });
});

describe("arrow key steps", () => {
    it("moves by 1, 10 with Shift, 0.1 with Alt", () => {
        expect(arrowKeyStep({ shiftKey: false, altKey: false })).toBe(1);
        expect(arrowKeyStep({ shiftKey: true, altKey: false })).toBe(10);
        expect(arrowKeyStep({ shiftKey: false, altKey: true })).toBe(0.1);
    });

    it("leaves no float noise behind", () => {
        expect(stepNumber(0.2, 0.1)).toBe(0.3);
    });
});
