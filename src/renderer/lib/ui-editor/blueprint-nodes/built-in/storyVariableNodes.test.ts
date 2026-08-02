/**
 * Story variable nodes (Scene Var / Saved Var). Get Scene Var and Get Saved Var are
 * exec nodes that publish through `execute()`'s `outputValues`, so the assertions read
 * the `value` pin from a downstream node - the path that silently yielded `undefined`
 * until both types were registered in `resolveSelfOutput`.
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_SAVED_GET,
    BLUEPRINT_NODE_TYPE_SAVED_SET,
    BLUEPRINT_NODE_TYPE_SCENE_GET,
    BLUEPRINT_NODE_TYPE_SCENE_SET,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

function createStoryHostAdapter(
    sceneVars: Record<string, unknown>,
    savedVars: Record<string, unknown>,
): UIHostAdapter {
    return {
        host: "player",
        storyRuntime: {
            sceneVar: {
                get: (id: string) => sceneVars[id],
                set: (id: string, value: unknown) => {
                    sceneVars[id] = value;
                },
            },
            savedVar: {
                get: (id: string) => savedVars[id],
                set: (id: string, value: unknown) => {
                    savedVars[id] = value;
                },
            },
        },
    } as unknown as UIHostAdapter;
}

/** Getter node whose `value` output pin feeds a Set Var named `out`. */
function readVariableGraph(getterType: string, params: Record<string, unknown>): UIGraph {
    return {
        id: "readStoryVar",
        entries: { main: { start: { nodeId: "get", port: "in" } } },
        nodes: {
            get: { id: "get", type: getterType, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "get", port: "value" }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

describe("Story variable blueprint nodes", () => {
    it("publishes Get Scene Var to a downstream data pin", async () => {
        const locals: Record<string, unknown> = {};
        await executeGraph({
            graph: readVariableGraph(BLUEPRINT_NODE_TYPE_SCENE_GET, { sceneVariableId: "mood" }),
            entry: { start: { nodeId: "get", port: "in" } },
            hostAdapter: createStoryHostAdapter({ mood: "tense" }, {}),
            blueprintLocals: locals,
        });
        expect(locals).toMatchObject({ out: "tense" });
    });

    it("publishes Get Saved Var to a downstream data pin", async () => {
        const locals: Record<string, unknown> = {};
        await executeGraph({
            graph: readVariableGraph(BLUEPRINT_NODE_TYPE_SAVED_GET, { savedVariableId: "affection" }),
            entry: { start: { nodeId: "get", port: "in" } },
            hostAdapter: createStoryHostAdapter({}, { affection: 12 }),
            blueprintLocals: locals,
        });
        expect(locals).toMatchObject({ out: 12 });
    });

    it("round-trips a value written by Set Scene Var back through Get Saved Var's twin", async () => {
        const sceneVars: Record<string, unknown> = {};
        const savedVars: Record<string, unknown> = {};
        await executeGraph({
            graph: {
                id: "writeThenRead",
                entries: { main: { start: { nodeId: "setScene", port: "in" } } },
                nodes: {
                    literal: {
                        id: "literal",
                        type: BLUEPRINT_NODE_TYPE_LITERAL_STRING,
                        params: { value: "rainy" },
                    },
                    setScene: {
                        id: "setScene",
                        type: BLUEPRINT_NODE_TYPE_SCENE_SET,
                        params: { sceneVariableId: "weather" },
                    },
                    getScene: {
                        id: "getScene",
                        type: BLUEPRINT_NODE_TYPE_SCENE_GET,
                        params: { sceneVariableId: "weather" },
                    },
                    setSaved: {
                        id: "setSaved",
                        type: BLUEPRINT_NODE_TYPE_SAVED_SET,
                        params: { savedVariableId: "lastWeather" },
                    },
                },
                edges: [
                    { from: { nodeId: "literal", port: "value" }, to: { nodeId: "setScene", port: "value" } },
                    { from: { nodeId: "setScene", port: "next" }, to: { nodeId: "getScene", port: "in" } },
                    { from: { nodeId: "getScene", port: "next" }, to: { nodeId: "setSaved", port: "in" } },
                    { from: { nodeId: "getScene", port: "value" }, to: { nodeId: "setSaved", port: "value" } },
                ],
            } as UIGraph,
            entry: { start: { nodeId: "setScene", port: "in" } },
            hostAdapter: createStoryHostAdapter(sceneVars, savedVars),
        });
        expect(sceneVars).toEqual({ weather: "rainy" });
        expect(savedVars).toEqual({ lastWeather: "rainy" });
    });
});
