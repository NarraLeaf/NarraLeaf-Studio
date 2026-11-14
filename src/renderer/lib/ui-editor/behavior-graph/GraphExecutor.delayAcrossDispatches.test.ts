import { describe, expect, it } from "vitest";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import { BLUEPRINT_NODE_TYPE_FLOW_DELAY, BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY } from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import { executeGraph } from "./GraphExecutor";

describe("Delay across graph dispatches", () => {
    it.each([
        { layer: "layer", skipped: true },
        { layer: "another-layer", skipped: false },
    ])("only skips the matching authored layer: $layer", async ({ layer, skipped }) => {
        const graph: UIGraph = {
            id: buildBlueprintRunGraphId("blueprintEvent", "bp", "layer"),
            entries: {},
            nodes: {
                delay: { id: "delay", type: BLUEPRINT_NODE_TYPE_FLOW_DELAY, params: { duration: 30 } },
                skip: { id: "skip", type: BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY, params: {} },
            },
            edges: [{ from: { nodeId: "delay", port: "token" }, to: { nodeId: "skip", port: "timer" } }],
        };
        const controller = new AbortController();
        const owner = { blueprintId: "bp", surfaceId: "surface", elementId: "button" };
        let finished = false;
        const done = executeGraph({
            graph, entry: { start: { nodeId: "delay", port: "in" } }, hostAdapter: { host: "player" },
            executionOwner: owner, signal: controller.signal,
        }).then(() => { finished = true; }, () => undefined);
        try {
            await executeGraph({
                graph: { ...graph, id: buildBlueprintRunGraphId("broadcastEvent", "bp", layer) },
                entry: { start: { nodeId: "skip", port: "in" } }, hostAdapter: { host: "player" }, executionOwner: owner,
            });
            for (let index = 0; index < 10; index += 1) await Promise.resolve();
            expect(finished).toBe(skipped);
        } finally {
            controller.abort();
            await done;
        }
    });
});
