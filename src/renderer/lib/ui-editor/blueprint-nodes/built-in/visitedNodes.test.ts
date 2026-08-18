/**
 * The visited record's blueprint readers.
 *
 * Two things are being defended here, and only one of them is "the node returns the right boolean":
 *
 * 1. The READ path. A pure node's output is never produced by running `execute()` - the executor
 *    only walks exec flow - so it has to be resolvable through `resolveSelfOutput`. A pure node
 *    nobody registered there feeds `undefined` downstream with no error at all, which is precisely
 *    the failure this repo has paid for before. So the assertions read the pin from a DOWNSTREAM
 *    node rather than calling `execute` directly.
 * 2. Purity itself. The story expression language is meant to reach this same capability, and a
 *    function graph refuses any node that is latent or impure - so `isPure` here is a contract, not
 *    a detail, and a later "just make it async" would silently take the feature away.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_NODE_TYPE_GAME_CLEAR_VISITED,
  BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED,
  BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED,
  BLUEPRINT_NODE_TYPE_LOCAL_SET
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "../../behavior-graph/GraphExecutor";
import {
  blueprintNodeRegistry,
  isBlueprintNodeAllowedInGraphContext
} from "../BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import type { BlueprintPaletteContext } from "../types";

type VisitedState = { scenes: string[]; options: string[] };

function createVisitedHostAdapter(state: VisitedState): UIHostAdapter {
  return {
    host: "player",
    blueprintRuntime: {
      hostApi: {
        game: {
          isSceneVisited: (sceneId: string) => state.scenes.includes(sceneId),
          isOptionPicked: (optionId: string) => state.options.includes(optionId),
          clearVisited: () => {
            state.scenes = [];
            state.options = [];
          }
        }
      }
    }
  } as unknown as UIHostAdapter;
}

/** Reader node whose boolean pin feeds a Set Local named `out` - the downstream read path. */
function readerGraph(nodeType: string, pinId: string, params: Record<string, unknown>): UIGraph {
  return {
    id: "readVisited",
    entries: { main: { start: { nodeId: "store", port: "in" } } },
    nodes: {
      read: { id: "read", type: nodeType, params },
      store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
    },
    edges: [{ from: { nodeId: "read", port: pinId }, to: { nodeId: "store", port: "value" } }]
  } as UIGraph;
}

async function readPin(
  nodeType: string,
  pinId: string,
  params: Record<string, unknown>,
  state: VisitedState
): Promise<unknown> {
  const locals: Record<string, unknown> = {};
  await executeGraph({
    graph: readerGraph(nodeType, pinId, params),
    entry: { start: { nodeId: "store", port: "in" } },
    hostAdapter: createVisitedHostAdapter(state),
    blueprintLocals: locals
  });
  return locals.out;
}

const EMPTY: VisitedState = { scenes: [], options: [] };

describe("visited blueprint nodes", () => {
  it("registers all three types", () => {
    registerCoreBlueprintNodes();

    for (const type of [
      BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED,
      BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED,
      BLUEPRINT_NODE_TYPE_GAME_CLEAR_VISITED
    ]) {
      expect(blueprintNodeRegistry.get(type), type).toBeDefined();
    }
  });

  it("keeps both readers pure and non-latent, so a function graph still accepts them", () => {
    registerCoreBlueprintNodes();
    const context = {
      graphKind: "function",
      owner: { kind: "globalMain" }
    } as BlueprintPaletteContext;

    for (const type of [
      BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED,
      BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED
    ]) {
      const def = blueprintNodeRegistry.get(type)!;
      expect(def.isPure, type).toBe(true);
      expect(def.isLatent, type).toBeFalsy();
      expect(isBlueprintNodeAllowedInGraphContext(def, context), type).toBe(true);
    }
  });

  it("reads Is Scene Visited as true for a visited scene and false for one never entered", async () => {
    const state: VisitedState = { scenes: ["scene-1"], options: [] };

    await expect(
      readPin(BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED, "isVisited", { sceneId: "scene-1" }, state)
    ).resolves.toBe(true);
    await expect(
      readPin(BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED, "isVisited", { sceneId: "scene-2" }, state)
    ).resolves.toBe(false);
  });

  it("reads Is Option Picked as true only for an option that was actually picked", async () => {
    const state: VisitedState = { scenes: ["scene-1"], options: ["opt-a"] };

    await expect(
      readPin(BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED, "isPicked", { optionId: "opt-a" }, state)
    ).resolves.toBe(true);
    // `opt-b` sat in the same menu as `opt-a`; being shown is not being picked.
    await expect(
      readPin(BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED, "isPicked", { optionId: "opt-b" }, state)
    ).resolves.toBe(false);
  });

  it("reads false rather than undefined when nothing is picked in the inspector", async () => {
    // A half-wired gallery row must stay locked, not resolve to `undefined` and light up.
    await expect(
      readPin(BLUEPRINT_NODE_TYPE_GAME_IS_SCENE_VISITED, "isVisited", {}, EMPTY)
    ).resolves.toBe(false);
    await expect(
      readPin(BLUEPRINT_NODE_TYPE_GAME_IS_OPTION_PICKED, "isPicked", {}, EMPTY)
    ).resolves.toBe(false);
  });

  it("wipes both collections through Clear Visited", async () => {
    const state: VisitedState = { scenes: ["scene-1", "scene-2"], options: ["opt-a"] };

    await executeGraph({
      graph: {
        id: "clearVisited",
        entries: { main: { start: { nodeId: "clear", port: "in" } } },
        nodes: { clear: { id: "clear", type: BLUEPRINT_NODE_TYPE_GAME_CLEAR_VISITED, params: {} } },
        edges: []
      } as UIGraph,
      entry: { start: { nodeId: "clear", port: "in" } },
      hostAdapter: createVisitedHostAdapter(state)
    });

    expect(state).toEqual({ scenes: [], options: [] });
  });
});
