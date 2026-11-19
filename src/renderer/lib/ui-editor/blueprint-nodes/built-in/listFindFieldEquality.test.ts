import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
} from "@shared/types/blueprint/graph";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue, type DataPinGraph, type DataPinResolveRuntime } from "./graphParamResolvers";

const struct: UIStructDef = {
    id: "row",
    fields: [{ id: "detail-id", key: "detail", type: "json" }],
};

function nested(value: unknown, depth: number): unknown {
    for (let index = 0; index < depth; index += 1) {
        value = { child: value };
    }
    return value;
}

function find(type: string, stored: unknown, requested: unknown) {
    const params = { field: "detail-id" };
    const element = type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD;
    const row = { detail: stored };
    const graph: DataPinGraph = {
        id: "find-by-field",
        nodes: {
            find: { type, params },
            value: { type: BLUEPRINT_NODE_TYPE_LITERAL_JSON, params: { value: requested } },
            ref: { type: BLUEPRINT_NODE_TYPE_ELEMENT_REF, params: { surfaceId: "page", elementId: "list", elementType: "nl.list" } },
        },
        edges: [
            { from: { nodeId: "value", port: "value" }, to: { nodeId: "find", port: "value" } },
            ...(element ? [{ from: { nodeId: "ref", port: "element" }, to: { nodeId: "find", port: "list" } }] : []),
        ],
    };
    const runtime = {
        executionOwner: { surfaceId: "page", elementId: element ? "button" : "list" },
        hostAdapter: {
            blueprintRuntime: {
                hostApi: { widget: { getListProperties: () => ({ items: [{ detail: "other" }, row], struct }) } },
            },
        },
    } as unknown as DataPinResolveRuntime;
    const read = (pin: string) => resolveDataPinValue(graph, "find", pin, params, {}, 0, runtime);
    return { found: read("found"), index: read("index"), item: read("item"), row };
}

beforeAll(() => registerCoreBlueprintNodes());

describe.each([
    BLUEPRINT_NODE_TYPE_LIST_FIND_ITEM_BY_FIELD,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_FIND_ITEM_BY_FIELD,
])("%s compares JSON field values", type => {
    it("finds nested objects regardless of property order", () => {
        const result = find(type, { name: "Ada", detail: { a: 1, b: 2 } }, { detail: { b: 2, a: 1 }, name: "Ada" });
        expect(result).toEqual({ found: true, index: 1, item: result.row, row: result.row });
    });

    it("finds reordered properties in nested JSON within the shared comparison limit", () => {
        const result = find(type, nested({ a: 1, b: 2 }, 63), nested({ b: 2, a: 1 }, 63));
        expect(result).toEqual({ found: true, index: 1, item: result.row, row: result.row });
    });

    it("uses the shared depth limit for separately held JSON", () => {
        const result = find(type, nested({ a: 1, b: 2 }, 65), nested({ a: 1, b: 2 }, 65));
        expect(result).toEqual({ found: false, index: -1, item: null, row: result.row });
    });

    it("reports a missing value with no item", () => {
        const result = find(type, { a: 1 }, { a: 2 });
        expect(result).toEqual({ found: false, index: -1, item: null, row: result.row });
    });
});
