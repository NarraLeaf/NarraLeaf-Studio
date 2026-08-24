/**
 * `Is DLC Installed`.
 *
 * Two things are defended here, and only one of them is "the node returns the right value":
 *
 * 1. The READ path. A pure node's output is never produced by running `execute()` - the executor
 *    only walks exec flow - so it has to be resolvable through the data-pin resolver. A pure node
 *    nobody registered there feeds `undefined` downstream with no error at all, which is precisely
 *    the failure this repo has paid for before. So the assertions read the pin from a DOWNSTREAM
 *    node rather than calling `execute` directly.
 * 2. Purity itself. A function graph refuses any node that is latent or impure, and a main menu
 *    binding "is the extra story here" straight to a row's hidden look needs exactly that. A later
 *    "just make it async" would take the capability away from every function graph and every bound
 *    pin at once.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";

/** The host half, standing in for `GameApp`'s read of what the layer stack found. */
function createDlcHostAdapter(installed: string[]): UIHostAdapter {
    return {
        host: "player",
        blueprintRuntime: {
            hostApi: {
                game: {
                    isDlcInstalled: (dlcId: string) => installed.includes(dlcId),
                },
            },
        },
    } as unknown as UIHostAdapter;
}

/** Reader node whose output pin feeds a Set Local named `out` - the downstream read path. */
function readerGraph(params: Record<string, unknown>): UIGraph {
    return {
        id: "readDlc",
        entries: { main: { start: { nodeId: "store", port: "in" } } },
        nodes: {
            read: { id: "read", type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED, params },
            store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
        },
        edges: [
            { from: { nodeId: "read", port: "isInstalled" }, to: { nodeId: "store", port: "value" } },
        ],
    } as UIGraph;
}

async function readPin(params: Record<string, unknown>, installed: string[]): Promise<unknown> {
    const locals: Record<string, unknown> = {};
    await executeGraph({
        graph: readerGraph(params),
        entry: { start: { nodeId: "store", port: "in" } },
        hostAdapter: createDlcHostAdapter(installed),
        blueprintLocals: locals,
    });
    return locals.out;
}

describe("Is DLC Installed", () => {
    it("is registered, pure and available to a function graph", () => {
        registerCoreBlueprintNodes();

        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED);
        expect(def).toBeDefined();
        expect(def?.isPure).toBe(true);
        expect(def?.isLatent).toBe(false);
        expect(def?.graphKinds).toContain("function");
    });

    it("answers from what the host says is installed", async () => {
        registerCoreBlueprintNodes();

        expect(await readPin({ dlcId: "summer" }, ["summer"])).toBe(true);
        expect(await readPin({ dlcId: "summer" }, ["winter"])).toBe(false);
        expect(await readPin({ dlcId: "summer" }, [])).toBe(false);
    });

    it("reads an unpicked DLC as not installed rather than taking the menu down", async () => {
        registerCoreBlueprintNodes();

        // A half-wired row on a main menu stays hidden. Throwing here would take out the screen the
        // player is looking at, over a field the author has not filled in yet.
        expect(await readPin({}, ["summer"])).toBe(false);
        expect(await readPin({ dlcId: "   " }, ["summer"])).toBe(false);
    });
});
