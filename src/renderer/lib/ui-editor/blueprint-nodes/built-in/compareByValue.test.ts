/**
 * Equal and Not Equal compare what two values hold, by the rule the array nodes already used.
 *
 * They used to compare by identity. Every read of an Element, a Color, a Vector2D, an Image or a Save
 * Slot builds a new record, so such a value was unequal even to itself - an Element node wired into
 * both pins of Equal answered false - and two JSON values with the same contents were equal only
 * when they happened to be the same object.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";

type Source = { type: string; params?: Record<string, unknown> };

const EQUAL = "blueprint.compare.equal";
const NOT_EQUAL = "blueprint.compare.notEqual";
const GREATER = "blueprint.compare.greaterThan";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

function compare(op: string, a: Source | undefined, b: Source | "a" | undefined): unknown {
    const nodes: NonNullable<DataPinGraph["nodes"]> = { cmp: { type: op, params: {} } };
    const edges: NonNullable<DataPinGraph["edges"]> = [];
    const port = (source: Source) =>
        source.type === "blueprint.element.ref" ? "element" : source.type === "blueprint.game.saveSlot" ? "slot" : "value";
    if (a) {
        nodes.a = a;
        edges.push({ from: { nodeId: "a", port: port(a) }, to: { nodeId: "cmp", port: "a" } });
    }
    if (b === "a" && a) {
        edges.push({ from: { nodeId: "a", port: port(a) }, to: { nodeId: "cmp", port: "b" } });
    } else if (b && b !== "a") {
        nodes.b = b;
        edges.push({ from: { nodeId: "b", port: port(b) }, to: { nodeId: "cmp", port: "b" } });
    }
    edges.push({ from: { nodeId: "cmp", port: "result" }, to: { nodeId: "probe", port: "value" } });
    return resolveDataPinValue({ id: "graph", nodes, edges }, "probe", "value", {}, undefined, 0);
}

const literal = (kind: string, value?: unknown): Source => ({
    type: `blueprint.data.${kind}Literal`,
    params: value === undefined ? {} : { value },
});
const element = (elementId = "e1"): Source => ({
    type: "blueprint.element.ref",
    params: { surfaceId: "surface", elementId, elementType: "nl.text" },
});

describe("Equal and Not Equal", () => {
    it("keep comparing plain values strictly", () => {
        expect(compare(EQUAL, literal("integer", 1), literal("float", 1))).toBe(true);
        expect(compare(EQUAL, literal("integer", 1), literal("string", "1"))).toBe(false);
        expect(compare(EQUAL, literal("boolean", "true"), literal("integer", 1))).toBe(false);
        expect(compare(EQUAL, literal("string", "a"), literal("string", "a"))).toBe(true);
    });

    it("call an element equal to itself and to another read of it, and unequal to another element", () => {
        expect(compare(EQUAL, element(), "a")).toBe(true);
        expect(compare(EQUAL, element(), element())).toBe(true);
        expect(compare(EQUAL, element(), element("e2"))).toBe(false);
        expect(compare(NOT_EQUAL, element(), element())).toBe(false);
    });

    it("compare colours, points and JSON by what they hold", () => {
        expect(compare(EQUAL, literal("color", { r: 1, g: 2, b: 3, a: 1 }), literal("color", { r: 1, g: 2, b: 3, a: 1 }))).toBe(true);
        expect(compare(EQUAL, literal("vector2d", { x: 1, y: 2 }), "a")).toBe(true);
        expect(compare(EQUAL, literal("json", { a: 1, b: [2] }), literal("json", { b: [2], a: 1 }))).toBe(true);
        expect(compare(EQUAL, literal("json", [1]), literal("json", [1, 2]))).toBe(false);
        expect(compare(EQUAL, literal("json", 5), literal("integer", 5))).toBe(true);
    });

    it("read an unconnected input as Null, as Is Null does", () => {
        expect(compare(EQUAL, literal("null"), undefined)).toBe(true);
        expect(compare(EQUAL, undefined, undefined)).toBe(true);
        expect(compare(EQUAL, literal("null"), literal("string", ""))).toBe(false);
        expect(compare(EQUAL, literal("null"), literal("integer", 0))).toBe(false);
    });

    it("leave the ordering comparisons reading numbers as before", () => {
        expect(compare(GREATER, literal("string", "2"), literal("integer", 1))).toBe(true);
        expect(compare(GREATER, literal("boolean", "true"), literal("integer", 0))).toBe(true);
        expect(compare(GREATER, literal("null"), literal("integer", -1))).toBe(false);
        expect(compare(GREATER, literal("json", [5]), literal("integer", 1))).toBe(false);
    });
});
