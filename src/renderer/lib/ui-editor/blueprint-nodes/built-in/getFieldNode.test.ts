/**
 * What Get Field reads when the graph runs.
 *
 * Three places a struct can come from, and the editor shows which one a node is using: a wire into
 * `object`, the list row the node sits in when nothing is wired, or nothing at all when the node was
 * pointed at a shape and has lost its wire. The runtime has to agree with the card on every one of
 * them - an orphan that quietly read the row would be a node doing something its card says it is not.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_PARAM_FIELD,
    BLUEPRINT_NODE_PARAM_FIELD_STRUCT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LITERAL,
} from "@shared/types/blueprint/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { resolveDataPinValue, type DataPinGraph } from "./graphParamResolvers";

beforeAll(() => {
    registerCoreBlueprintNodes();
});

const ROW_STRUCT: UIStructDef = { id: "rowShape", fields: [{ id: "f1", key: "title", type: "string" }] };
const ROW: UIListItemScope = {
    item: { title: "Chapter one", isReached: true },
    index: 0,
    count: 1,
    key: "0",
    struct: ROW_STRUCT,
} as UIListItemScope;

const ENDING = { endingId: "e1", name: "Festival together", sceneId: "s1", sceneName: "Last light", isReached: true };

function read(
    params: Record<string, unknown>,
    options: { wired?: unknown; row?: UIListItemScope; documentStructs?: Record<string, UIStructDef> } = {},
): unknown {
    const nodes: Record<string, unknown> = {
        read: { id: "read", type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params },
    };
    const edges = [];
    if (options.wired !== undefined) {
        nodes.source = { id: "source", type: BLUEPRINT_NODE_TYPE_LITERAL, params: { value: options.wired } };
        edges.push({ from: { nodeId: "source", port: "value" }, to: { nodeId: "read", port: "object" } });
    }
    const graph = { id: "graph", nodes, edges } as unknown as DataPinGraph;
    const runtime = {
        ...(options.row ? { listItemScope: options.row } : {}),
        ...(options.documentStructs
            ? { hostAdapter: { blueprintRuntime: { resolveStruct: (id: string) => options.documentStructs?.[id] ?? null } } }
            : {}),
    } as Parameters<typeof resolveDataPinValue>[6];
    return resolveDataPinValue(graph, "read", "value", params, {}, 0, runtime);
}

describe("Get Field", () => {
    it("reads a field of the struct wired into it", () => {
        expect(read({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", [BLUEPRINT_NODE_PARAM_FIELD]: "isReached" }, { wired: ENDING }))
            .toBe(true);
        expect(read({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", [BLUEPRINT_NODE_PARAM_FIELD]: "name" }, { wired: ENDING }))
            .toBe("Festival together");
    });

    it("answers a missing value with the field type's empty value, not undefined", () => {
        const { name: _name, ...nameless } = ENDING;
        expect(read({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", [BLUEPRINT_NODE_PARAM_FIELD]: "name" }, { wired: nameless }))
            .toBe("");
    });

    it("reads a list's own shape wired in by the field's name, from the document the surface runs", () => {
        const params = { [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "rowShape", [BLUEPRINT_NODE_PARAM_FIELD]: "f1" };
        expect(read(params, { wired: { title: "Chapter two" }, documentStructs: { rowShape: ROW_STRUCT } })).toBe("Chapter two");
        // The row in scope answers for its own shape where no document is to hand.
        expect(read(params, { wired: { title: "Chapter two" }, row: ROW })).toBe("Chapter two");
    });

    it("reads the wire rather than the row when both are there", () => {
        expect(
            read({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", [BLUEPRINT_NODE_PARAM_FIELD]: "name" }, { wired: ENDING, row: ROW }),
        ).toBe("Festival together");
    });

    it("reads the row it sits in when nothing is wired and nothing pinned it", () => {
        expect(read({ [BLUEPRINT_NODE_PARAM_FIELD]: "f1" }, { row: ROW })).toBe("Chapter one");
    });

    it("reads nothing once a node pointed at a shape has lost its wire, even inside a row", () => {
        expect(read({ [BLUEPRINT_NODE_PARAM_FIELD_STRUCT]: "nl.ending", [BLUEPRINT_NODE_PARAM_FIELD]: "isReached" }, { row: ROW }))
            .toBeNull();
    });
});
