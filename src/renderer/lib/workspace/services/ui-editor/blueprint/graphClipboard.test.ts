import { describe, expect, it } from "vitest";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
} from "@shared/types/blueprint/graph";
import { createBlueprintFnRef, parseBlueprintFnRef } from "./fnCatalog";
import {
    BLUEPRINT_GRAPH_CLIPBOARD_KIND,
    BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
    buildBlueprintGraphClipboardPayload,
    pasteBlueprintGraphClipboardPayload,
    readBlueprintGraphClipboardPayload,
} from "./graphClipboard";

function testIr(): BlueprintGraphIr {
    return {
        nodes: {
            a: {
                id: "a",
                type: "source",
                params: { value: 1 },
                meta: { editorLayout: { x: 10, y: 20 } },
            },
            b: {
                id: "b",
                type: "target",
                params: { value: 2 },
                meta: { editorLayout: { x: 160, y: 20 } },
            },
            c: {
                id: "c",
                type: "outside",
                meta: { editorLayout: { x: 320, y: 20 } },
            },
        },
        edges: [
            { from: { nodeId: "a", port: "next" }, to: { nodeId: "b", port: "in" } },
            { from: { nodeId: "b", port: "next" }, to: { nodeId: "c", port: "in" } },
        ],
    };
}

describe("blueprint graph clipboard", () => {
    it("copies selected nodes with only their internal connections", () => {
        const payload = buildBlueprintGraphClipboardPayload(testIr(), ["a", "b"]);

        expect(payload?.nodeIds).toEqual(["a", "b"]);
        expect(Object.keys(payload?.nodes ?? {})).toEqual(["a", "b"]);
        expect(payload?.edges).toEqual([
            { from: { nodeId: "a", port: "next" }, to: { nodeId: "b", port: "in" } },
        ]);
    });

    it("pastes copied nodes with new ids and remapped internal connections", () => {
        const ir = testIr();
        const payload = buildBlueprintGraphClipboardPayload(ir, ["a", "b"]);
        const ids = ["new-a", "new-b"];

        const result = pasteBlueprintGraphClipboardPayload({
            ir,
            payload,
            generateId: () => ids.shift()!,
        });

        expect(result?.newNodeIds).toEqual(["new-a", "new-b"]);
        expect(result?.ir.nodes?.["new-a"]).toMatchObject({
            id: "new-a",
            type: "source",
            params: { value: 1 },
            meta: { editorLayout: { x: 58, y: 68 } },
        });
        expect(result?.ir.nodes?.["new-b"]).toMatchObject({
            id: "new-b",
            type: "target",
            meta: { editorLayout: { x: 208, y: 68 } },
        });
        expect(result?.ir.edges).toContainEqual({
            from: { nodeId: "new-a", port: "next" },
            to: { nodeId: "new-b", port: "in" },
        });
        expect(ir.nodes?.["new-a"]).toBeUndefined();
    });

    it("moves a repeated paste further when the default offset is already occupied", () => {
        const ir = testIr();
        const payload = buildBlueprintGraphClipboardPayload(ir, ["a"]);
        const first = pasteBlueprintGraphClipboardPayload({
            ir,
            payload,
            generateId: () => "new-a-1",
        });
        const second = pasteBlueprintGraphClipboardPayload({
            ir: first!.ir,
            payload,
            generateId: () => "new-a-2",
        });

        expect(first?.ir.nodes?.["new-a-1"]?.meta?.editorLayout).toEqual({ x: 58, y: 68 });
        expect(second?.ir.nodes?.["new-a-2"]?.meta?.editorLayout).toEqual({ x: 106, y: 116 });
    });

    it("assigns pasted Var declaration nodes a fresh variable id", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                varNode: {
                    id: "varNode",
                    type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
                    params: { variableId: "varNode", name: "score", valueType: "integer", defaultValue: 0 },
                    meta: { editorLayout: { x: 10, y: 20 } },
                },
            },
            edges: [],
        };
        const payload = buildBlueprintGraphClipboardPayload(ir, ["varNode"]);

        const result = pasteBlueprintGraphClipboardPayload({
            ir,
            payload,
            generateId: () => "varNodeCopy",
        });

        expect(result?.ir.nodes?.varNodeCopy?.params).toMatchObject({
            variableId: "varNodeCopy",
            name: "score",
            valueType: "integer",
        });
    });

    it("re-points a Call Fn at the pasted head when both are copied together", () => {
        const fnRef = createBlueprintFnRef("bp-src", "head");
        const ir: BlueprintGraphIr = {
            nodes: {
                head: {
                    id: "head",
                    type: BLUEPRINT_NODE_TYPE_FN_HEAD,
                    params: { name: "Echo" },
                    meta: { editorLayout: { x: 0, y: 0 } },
                },
                call: {
                    id: "call",
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: { [BLUEPRINT_NODE_PARAM_FN_REF]: fnRef },
                    meta: { editorLayout: { x: 160, y: 0 } },
                },
            },
            edges: [],
        };
        const payload = buildBlueprintGraphClipboardPayload(ir, ["head", "call"]);
        const ids = ["headCopy", "callCopy"];

        const result = pasteBlueprintGraphClipboardPayload({
            ir,
            payload,
            generateId: () => ids.shift()!,
            targetBlueprintId: "bp-dst",
        });

        expect(parseBlueprintFnRef(result?.ir.nodes?.callCopy?.params?.[BLUEPRINT_NODE_PARAM_FN_REF])).toEqual({
            blueprintId: "bp-dst",
            headNodeId: "headCopy",
        });
    });

    it("keeps a lone Call Fn ref untouched so validation can flag missing targets", () => {
        const fnRef = createBlueprintFnRef("bp-src", "head");
        const ir: BlueprintGraphIr = {
            nodes: {
                call: {
                    id: "call",
                    type: BLUEPRINT_NODE_TYPE_FN_CALL,
                    params: { [BLUEPRINT_NODE_PARAM_FN_REF]: fnRef },
                    meta: { editorLayout: { x: 0, y: 0 } },
                },
            },
            edges: [],
        };
        const payload = buildBlueprintGraphClipboardPayload(ir, ["call"]);

        const result = pasteBlueprintGraphClipboardPayload({
            ir,
            payload,
            generateId: () => "callCopy",
            targetBlueprintId: "bp-dst",
        });

        expect(result?.ir.nodes?.callCopy?.params?.[BLUEPRINT_NODE_PARAM_FN_REF]).toBe(fnRef);
    });
});

/**
 * The payload as it survives a trip through the platform clipboard.
 *
 * Everything here is about a payload written by *another process*: the JSON has to be rebuilt
 * rather than trusted, and every id inside it has to arrive exactly as it left - a paste that
 * silently emptied a param would trade a reported broken reference for an unreported empty one.
 */
describe("blueprint graph clipboard payload transport", () => {
    const source = { path: "D:/Projects/Other", identifier: "com.example.other", name: "Other" };

    it("round-trips a stamped payload through JSON", () => {
        const payload = buildBlueprintGraphClipboardPayload(testIr(), ["a", "b"], { copyId: "copy-1", source });

        const parsed = readBlueprintGraphClipboardPayload(JSON.stringify(payload));

        expect(parsed).toEqual(payload);
        expect(parsed?.source).toEqual(source);
        expect(parsed?.copyId).toBe("copy-1");
    });

    it("keeps every param verbatim, foreign ids included", () => {
        const ir: BlueprintGraphIr = {
            nodes: {
                n: {
                    id: "n",
                    type: "plugin.contributed",
                    params: { assetId: "asset-from-elsewhere", nested: { keep: ["me", 1, true] } },
                },
            },
            edges: [],
        };
        const payload = buildBlueprintGraphClipboardPayload(ir, ["n"], { copyId: "copy-2", source });

        const parsed = readBlueprintGraphClipboardPayload(JSON.stringify(payload));

        expect(parsed?.nodes.n?.params).toEqual({
            assetId: "asset-from-elsewhere",
            nested: { keep: ["me", 1, true] },
        });
    });

    it("refuses anything that is not one of its own payloads", () => {
        expect(readBlueprintGraphClipboardPayload("not json at all")).toBeNull();
        expect(readBlueprintGraphClipboardPayload(JSON.stringify({ v: 1, nodeIds: ["a"] }))).toBeNull();
        expect(
            readBlueprintGraphClipboardPayload(
                JSON.stringify({ kind: "narraleaf.ui.elements", v: 1, nodeIds: ["a"], nodes: {}, edges: [] }),
            ),
        ).toBeNull();
    });

    it("drops nodes and edges a foreign payload cannot account for", () => {
        const json = JSON.stringify({
            kind: BLUEPRINT_GRAPH_CLIPBOARD_KIND,
            v: BLUEPRINT_GRAPH_CLIPBOARD_VERSION,
            nodeIds: ["a", "ghost"],
            nodes: {
                a: { id: "a", type: "source" },
                // No `type`: nothing downstream can look this up, so it cannot be placed.
                shapeless: { id: "shapeless" },
            },
            edges: [
                { from: { nodeId: "a", port: "next" }, to: { nodeId: "ghost", port: "in" } },
                { from: { nodeId: "a", port: "next" }, to: { nodeId: "a", port: "in" } },
            ],
        });

        const parsed = readBlueprintGraphClipboardPayload(json);

        expect(parsed?.nodeIds).toEqual(["a"]);
        expect(Object.keys(parsed?.nodes ?? {})).toEqual(["a"]);
        expect(parsed?.edges).toEqual([
            { from: { nodeId: "a", port: "next" }, to: { nodeId: "a", port: "in" } },
        ]);
    });
});
