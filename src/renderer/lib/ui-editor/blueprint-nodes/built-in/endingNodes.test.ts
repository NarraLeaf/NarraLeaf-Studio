/**
 * The endings record's blueprint nodes.
 *
 * Three things are defended here, and only one of them is "the node returns the right value":
 *
 * 1. The READ path. A pure node's output is never produced by running `execute()` - the executor
 *    only walks exec flow - so it has to be resolvable through `resolveSelfOutput`. A pure node
 *    nobody registered there feeds `undefined` downstream with no error at all, which is precisely
 *    the failure this repo has paid for before. So the assertions read the pin from a DOWNSTREAM
 *    node rather than calling `execute` directly.
 * 2. Purity itself. A function graph refuses any node that is latent or impure, so `isPure` on the
 *    two readers is a contract rather than a detail, and a later "just make it async" would take
 *    the capability away from every function graph and every bound pin.
 * 3. Latency on the two wipes, which is the opposite contract. Both write host persistence, so an
 *    author who clears a record and reads it back on the next node has to see the cleared record;
 *    `isLatent: false` would let the read run first.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDINGS,
    BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE,
    BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
    BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { StoryDocument } from "@shared/types/story";
import { listStoryEndings } from "@shared/types/story";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import type { BlueprintPaletteContext } from "../types";

/** One story's endings as the scan produces them, plus the ids the record holds. */
type EndingsState = {
    /** Keyed by story id, the way the host resolves a document out of the shipped library. */
    stories: Record<string, StoryDocument>;
    reached: string[];
};

/**
 * The host half, standing in for `GameApp`'s reads of the endings record.
 *
 * `listEndings` runs the real `listStoryEndings` over a real document and joins it against
 * `reached`, because the join is the part worth asserting: a row that carried the wrong
 * `isReached` would light every cell of a gallery up and nothing else would notice.
 */
function createEndingsHostAdapter(state: EndingsState): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            hostApi: {
                game: {
                    isEndingReached: (endingId: string) => state.reached.includes(endingId),
                    listEndings: (storyId: string) => {
                        const document = state.stories[storyId];
                        if (!document) {
                            return [];
                        }
                        return listStoryEndings(document).map(ending => ({
                            endingId: ending.endingId,
                            name: ending.name,
                            sceneId: ending.sceneId,
                            sceneName: ending.sceneName,
                            isReached: state.reached.includes(ending.endingId),
                        }));
                    },
                    clearEndingState: async (endingId: string) => {
                        state.reached = state.reached.filter(id => id !== endingId);
                    },
                    clearEndings: async () => {
                        state.reached = [];
                    },
                },
            },
        },
    } as unknown as UIHostAdapter;
}

/**
 * A story with two ending rows in one scene, shaped the way the story document stores them.
 *
 * Built rather than stubbed so the scan under test is the one the compiler emits from: an `ending`
 * row IS the declaration, and a test that handed the host a list would prove nothing about that.
 */
function storyWithEndings(): StoryDocument {
    const rows = ["ending-good", "ending-bad"].map((id, index) => ({
        id,
        kind: "control" as const,
        payload: { control: "ending" as const, name: index === 0 ? "Sunrise" : "Ashes" },
        childrenIds: [],
    }));
    return {
        id: "story-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Final Hours",
                rootBlockIds: rows.map(row => row.id),
                blocks: Object.fromEntries(rows.map(row => [row.id, row])),
            },
        },
        unassignedSceneIds: ["scene-1"],
    } as unknown as StoryDocument;
}

/** Reader node whose output pin feeds a Set Local named `out` - the downstream read path. */
function readerGraph(nodeType: string, pinId: string, params: Record<string, unknown>): UIGraph {
    return {
        id: "readEndings",
        entries: { main: { start: { nodeId: "store", port: "in" } } },
        nodes: {
            read: { id: "read", type: nodeType, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "read", port: pinId }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

async function readPin(
    nodeType: string,
    pinId: string,
    params: Record<string, unknown>,
    state: EndingsState,
): Promise<unknown> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: readerGraph(nodeType, pinId, params),
        entry: { start: { nodeId: "store", port: "in" } },
        hostAdapter: createEndingsHostAdapter(state),
        blueprintLocals: locals,
    });
    return locals.out;
}

/** Run one exec node on its own. Both wipes take their target from `params`. */
async function runExecNode(
    nodeType: string,
    params: Record<string, unknown>,
    state: EndingsState,
): Promise<void> {
    await executeGraph({
        graph: {
            id: "clearEndings",
            entries: { main: { start: { nodeId: "clear", port: "in" } } },
            nodes: { clear: { id: "clear", type: nodeType, params } },
            edges: [],
        } as UIGraph,
        entry: { start: { nodeId: "clear", port: "in" } },
        hostAdapter: createEndingsHostAdapter(state),
    });
}

function stateWith(reached: string[]): EndingsState {
    return { stories: { "story-1": storyWithEndings() }, reached };
}

describe("ending blueprint nodes", () => {
    it("registers all four types", () => {
        registerCoreBlueprintNodes();

        for (const type of [
            BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
            BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
            BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE,
            BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDINGS,
        ]) {
            expect(blueprintNodeRegistry.get(type), type).toBeDefined();
        }
    });

    it("keeps both readers pure and non-latent, so a function graph still accepts them", () => {
        registerCoreBlueprintNodes();
        const context = { graphKind: "function", owner: { kind: "globalMain" } } as BlueprintPaletteContext;

        for (const type of [BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED, BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS]) {
            const def = blueprintNodeRegistry.get(type)!;
            expect(def.isPure, type).toBe(true);
            expect(def.isLatent, type).toBeFalsy();
            expect(isBlueprintNodeAllowedInGraphContext(def, context), type).toBe(true);
        }
    });

    it("keeps both wipes latent, so the write lands before the next node reads the record", () => {
        registerCoreBlueprintNodes();

        for (const type of [BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE, BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDINGS]) {
            const def = blueprintNodeRegistry.get(type)!;
            expect(def.isPure, type).toBe(false);
            expect(def.isLatent, type).toBe(true);
        }
    });

    it("reads Is Ending Reached as true for a reached ending and false for one never seen", async () => {
        const state = stateWith(["ending-good"]);

        await expect(readPin(
            BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
            "isReached",
            { storyId: "story-1", endingId: "ending-good" },
            state,
        )).resolves.toBe(true);
        await expect(readPin(
            BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
            "isReached",
            { storyId: "story-1", endingId: "ending-bad" },
            state,
        )).resolves.toBe(false);
    });

    it("answers Is Ending Reached from the ending alone, whatever story the picker names", async () => {
        // `storyId` narrows the picker; the record is keyed by the row's block id and nothing else,
        // so an ending stays unlocked even if the param naming its story is stale or empty.
        const state = stateWith(["ending-good"]);

        await expect(readPin(
            BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
            "isReached",
            { endingId: "ending-good" },
            state,
        )).resolves.toBe(true);
    });

    it("reads false rather than undefined when no ending is picked in the inspector", async () => {
        // A half-wired gallery row must stay locked, not resolve to `undefined` and light up.
        await expect(readPin(BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED, "isReached", {}, stateWith([])))
            .resolves.toBe(false);
    });

    it("hands Get Endings the whole scan, each row carrying its own unlock state", async () => {
        const state = stateWith(["ending-bad"]);

        await expect(readPin(
            BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
            "endings",
            { storyId: "story-1" },
            state,
        )).resolves.toEqual([
            {
                endingId: "ending-good",
                name: "Sunrise",
                sceneId: "scene-1",
                sceneName: "Final Hours",
                isReached: false,
            },
            {
                endingId: "ending-bad",
                name: "Ashes",
                sceneId: "scene-1",
                sceneName: "Final Hours",
                isReached: true,
            },
        ]);
    });

    it("names an ending the player has not reached rather than masking it", async () => {
        // The raw data node. Whether a locked row shows its name, a row of dashes or nothing at all
        // is the author's `if` inside the item template, not a decision taken here.
        const endings = await readPin(
            BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
            "endings",
            { storyId: "story-1" },
            stateWith([]),
        ) as Array<{ name: string; isReached: boolean }>;

        expect(endings.map(ending => ending.name)).toEqual(["Sunrise", "Ashes"]);
        expect(endings.every(ending => !ending.isReached)).toBe(true);
    });

    it("reads an empty array rather than undefined for no story and for an unknown one", async () => {
        await expect(readPin(BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS, "endings", {}, stateWith([])))
            .resolves.toEqual([]);
        await expect(readPin(
            BLUEPRINT_NODE_TYPE_GAME_GET_ENDINGS,
            "endings",
            { storyId: "story-missing" },
            stateWith([]),
        )).resolves.toEqual([]);
    });

    it("forgets exactly one ending through Clear Ending State", async () => {
        const state = stateWith(["ending-good", "ending-bad"]);

        await runExecNode(
            BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE,
            { storyId: "story-1", endingId: "ending-good" },
            state,
        );

        expect(state.reached).toEqual(["ending-bad"]);
    });

    it("leaves the record alone when Clear Ending State names no ending", async () => {
        const state = stateWith(["ending-good"]);

        await runExecNode(BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDING_STATE, {}, state);

        expect(state.reached).toEqual(["ending-good"]);
    });

    it("wipes the whole record through Clear Endings", async () => {
        const state = stateWith(["ending-good", "ending-bad"]);

        await runExecNode(BLUEPRINT_NODE_TYPE_GAME_CLEAR_ENDINGS, {}, state);

        expect(state.reached).toEqual([]);
    });
});
