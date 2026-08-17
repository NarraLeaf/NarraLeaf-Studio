/**
 * The make/break family, resolved for real.
 *
 * `graphParamResolvers.test.ts` proves every pure output pin resolves to *something*; this proves
 * these ones resolve to the right thing. The two halves are deliberately separate - the sweep is
 * about a whole class of silent failure, and it says nothing about arithmetic.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_DATA_BREAK_RECT,
    BLUEPRINT_NODE_TYPE_DATA_BREAK_VECTOR2D,
    BLUEPRINT_NODE_TYPE_DATA_MAKE_RECT,
    BLUEPRINT_NODE_TYPE_DATA_MAKE_VECTOR2D,
    BLUEPRINT_NODE_TYPE_DATA_RECT_CENTER,
    BLUEPRINT_NODE_TYPE_LITERAL_RECT,
} from "@shared/types/blueprint/graph";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

function graphOf(nodes: DataPinGraph["nodes"], edges: DataPinGraph["edges"] = []): DataPinGraph {
    return { id: "graph", nodes, edges } as DataPinGraph;
}

function read(graph: DataPinGraph, nodeId: string, portId: string): unknown {
    return resolveDataPinValue(graph, nodeId, portId, graph.nodes?.[nodeId]?.params ?? {}, {}, 0);
}

describe("geometry make/break nodes", () => {
    it("makes a vector from two literals", () => {
        const graph = graphOf({
            make: { type: BLUEPRINT_NODE_TYPE_DATA_MAKE_VECTOR2D, params: { x: 12, y: -3 } },
        });
        expect(read(graph, "make", "value")).toEqual({ x: 12, y: -3 });
    });

    it("breaks a rect into its four numbers", () => {
        const graph = graphOf(
            {
                rect: {
                    type: BLUEPRINT_NODE_TYPE_LITERAL_RECT,
                    params: { value: { x: 5, y: 6, width: 7, height: 8 } },
                },
                split: { type: BLUEPRINT_NODE_TYPE_DATA_BREAK_RECT, params: {} },
            },
            [{ from: { nodeId: "rect", port: "value" }, to: { nodeId: "split", port: "value" } }],
        );
        expect(read(graph, "split", "x")).toBe(5);
        expect(read(graph, "split", "y")).toBe(6);
        expect(read(graph, "split", "width")).toBe(7);
        expect(read(graph, "split", "height")).toBe(8);
    });

    it("folds a negative extent as it makes the rect, so the break reads the covered area", () => {
        const graph = graphOf({
            make: {
                type: BLUEPRINT_NODE_TYPE_DATA_MAKE_RECT,
                params: { x: 40, y: 60, width: -30, height: -40 },
            },
        });
        expect(read(graph, "make", "value")).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    });

    it("breaks a vector, which nothing in the catalogue could do before", () => {
        const graph = graphOf(
            {
                make: { type: BLUEPRINT_NODE_TYPE_DATA_MAKE_VECTOR2D, params: { x: 3, y: 4 } },
                split: { type: BLUEPRINT_NODE_TYPE_DATA_BREAK_VECTOR2D, params: {} },
            },
            [{ from: { nodeId: "make", port: "value" }, to: { nodeId: "split", port: "value" } }],
        );
        expect(read(graph, "split", "x")).toBe(3);
        expect(read(graph, "split", "y")).toBe(4);
    });

    it("centres a rect", () => {
        const graph = graphOf(
            {
                rect: {
                    type: BLUEPRINT_NODE_TYPE_LITERAL_RECT,
                    params: { value: { x: 10, y: 20, width: 30, height: 40 } },
                },
                centre: { type: BLUEPRINT_NODE_TYPE_DATA_RECT_CENTER, params: {} },
            },
            [{ from: { nodeId: "rect", port: "value" }, to: { nodeId: "centre", port: "value" } }],
        );
        expect(read(graph, "centre", "center")).toEqual({ x: 25, y: 40 });
    });
});
