import { describe, expect, it, vi } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_GAME_SAVE_CURRENT_RUN,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import type { UIHostAdapter } from "../../runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { acquireBlueprintExecutionLocals } from "../../blueprint-runtime/blueprintWidgetLocals";
import { MAX_LIVE_SAVE_CAPTURES } from "./saveCaptureStore";

function host(captureRun: () => Promise<unknown>, startStory = vi.fn()): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: { hostApi: { game: { captureRun, startStory } } },
    } as unknown as UIHostAdapter;
}

function captureGraph(): UIGraph {
    return {
        id: "capture-graph",
        entries: { main: { start: { nodeId: "capture", port: "in" } } },
        nodes: {
            capture: { id: "capture", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_CURRENT_RUN, params: {} },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "savedSlot" } },
        },
        edges: [
            { from: { nodeId: "capture", port: "next" }, to: { nodeId: "store", port: "in" } },
            { from: { nodeId: "capture", port: "slot" }, to: { nodeId: "store", port: "value" } },
        ],
    };
}

describe("Current Game execution lifetime", () => {
    it("counts simultaneous captures towards the execution limit", async () => {
        let finish!: (value: unknown) => void;
        const pending = new Promise<unknown>(resolve => { finish = resolve; });
        const captureRun = vi.fn(() => pending);
        const graph = captureGraph();
        const locals: Record<string, unknown> = {};
        const requests = Array.from({ length: MAX_LIVE_SAVE_CAPTURES + 1 }, () => executeGraph({
            graph,
            entry: graph.entries.main,
            hostAdapter: host(captureRun),
            blueprintLocals: locals,
        }));
        const results = Promise.allSettled(requests);
        finish({ saved: true });
        const settled = await results;

        expect(captureRun).toHaveBeenCalledTimes(MAX_LIVE_SAVE_CAPTURES);
        expect(settled.filter(result => result.status === "fulfilled")).toHaveLength(MAX_LIVE_SAVE_CAPTURES);
        expect(settled.filter(result => result.status === "rejected")).toHaveLength(1);
    });

    it("does not resolve an earlier execution's slot to a later capture from the same node", async () => {
        const captureRun = vi.fn()
            .mockResolvedValueOnce({ run: "earlier" })
            .mockResolvedValueOnce({ run: "later" });
        const startStory = vi.fn();
        const adapter = host(captureRun, startStory);
        const firstGraph = captureGraph();
        const blueprint = {
            id: "capture-lifetime-test",
            name: "Capture lifetime",
            owner: { kind: "globalMain" },
            members: {
                variables: { savedSlot: { id: "savedSlot", name: "Slot", valueType: "any", defaultValue: null } },
                fields: {},
                functions: {},
            },
            bindings: {},
            graphs: { events: {}, functions: {} },
        } as unknown as Blueprint;
        const document = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: { [blueprint.id]: blueprint },
            ownerRecords: {},
        } as unknown as BlueprintDocument;
        const acquire = () => acquireBlueprintExecutionLocals({ blueprintDocument: document, currentBlueprintId: blueprint.id });
        const firstLocals = acquire();
        await executeGraph({ graph: firstGraph, entry: firstGraph.entries.main, hostAdapter: adapter, blueprintLocals: firstLocals });

        const secondGraph: UIGraph = {
            id: firstGraph.id,
            entries: firstGraph.entries,
            nodes: {
                capture: firstGraph.nodes.capture,
                read: { id: "read", type: BLUEPRINT_NODE_TYPE_LOCAL_GET, params: { variableId: "savedSlot" } },
                start: { id: "start", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params: { storyId: "story", sceneId: "scene" } },
            },
            edges: [
                { from: { nodeId: "capture", port: "next" }, to: { nodeId: "start", port: "in" } },
                { from: { nodeId: "read", port: "value" }, to: { nodeId: "start", port: "inheritFrom" } },
            ],
        };
        await expect(executeGraph({
            graph: secondGraph,
            entry: secondGraph.entries.main,
            hostAdapter: adapter,
            blueprintLocals: acquire(),
        })).rejects.toThrow(/captured game this run does not hold/i);
        expect(startStory).not.toHaveBeenCalled();
    });

    it.each([null, new Error("capture failed")])("releases capacity after an unsuccessful capture", async failure => {
        const captureRun = vi.fn(() => failure instanceof Error ? Promise.reject(failure) : Promise.resolve(failure));
        const graph = captureGraph();
        const locals: Record<string, unknown> = {};
        const options = { graph, entry: graph.entries.main, hostAdapter: host(captureRun), blueprintLocals: locals };
        for (let index = 0; index <= MAX_LIVE_SAVE_CAPTURES; index += 1) {
            await expect(executeGraph(options)).rejects.toThrow();
        }
        expect(captureRun).toHaveBeenCalledTimes(MAX_LIVE_SAVE_CAPTURES + 1);
    });
});
