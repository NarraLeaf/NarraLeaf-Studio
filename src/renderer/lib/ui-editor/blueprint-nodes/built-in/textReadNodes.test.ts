/**
 * `Has Read Text` (`blueprint.game.isTextReadById`) - the by-id reader of the text-read record.
 *
 * Same shape of defence as `visitedNodes.test.ts`, for the same reason: this node is pure, and a
 * pure node's output is never produced by running `execute()` - the executor only walks exec flow,
 * so the value has to come out of `resolveSelfOutput`. A pure node nobody registered there feeds
 * `undefined` downstream with no error, no warning and no diagnostic, which is exactly how this
 * node shipped. So every assertion reads the pin from a DOWNSTREAM consumer, never by calling
 * `execute` directly - calling `execute` would pass while the shipped feature stayed dead.
 *
 * The second thing being defended is that it answers ITS question. Its sibling `Is Text Read`
 * publishes the same `isRead` port id but asks about the line currently on screen; the shared game
 * resolver matches on bare port ids, so folding this node into that whitelist would produce a
 * plausible-looking boolean that answers the wrong question.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ,
  BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ_BY_ID,
  BLUEPRINT_NODE_TYPE_LITERAL_STRING,
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

type TextReadState = {
  /** Ids the player has read, as the by-id record sees them. */
  read: string[];
  /** What the *current* line's reader answers - deliberately the opposite of the by-id record. */
  current: boolean;
};

function createTextReadHostAdapter(state: TextReadState): UIHostAdapter {
  return {
    host: "player",
    blueprintRuntime: {
      hostApi: {
        game: {
          isTextRead: (textId: string) => state.read.includes(textId),
          isCurrentTextRead: () => state.current
        }
      }
    }
  } as unknown as UIHostAdapter;
}

/**
 * Reader node whose boolean pin feeds a Set Local named `out`.
 *
 * `extraNodes` / `extraEdges` let a caller wire the `textId` input from a real upstream node, which
 * is the other half of the read path: the id may arrive through an edge rather than as an on-card
 * inline literal, and those take different branches inside `resolveDataPinValue`.
 */
function readerGraph(
  nodeType: string,
  pinId: string,
  params: Record<string, unknown>,
  extraNodes: UIGraph["nodes"] = {},
  extraEdges: UIGraph["edges"] = []
): UIGraph {
  return {
    id: "readTextRead",
    entries: { main: { start: { nodeId: "store", port: "in" } } },
    nodes: {
      read: { id: "read", type: nodeType, params },
      store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } },
      ...extraNodes
    },
    edges: [
      { from: { nodeId: "read", port: pinId }, to: { nodeId: "store", port: "value" } },
      ...extraEdges
    ]
  } as UIGraph;
}

async function readPin(graph: UIGraph, state: TextReadState): Promise<unknown> {
  const locals: Record<string, unknown> = {};
  await executeGraph({
    graph,
    entry: { start: { nodeId: "store", port: "in" } },
    hostAdapter: createTextReadHostAdapter(state),
    blueprintLocals: locals
  });
  return locals.out;
}

/** `Has Read Text` with the id supplied as an on-card inline literal (`params[pinId]`). */
function readByInlineId(textId: unknown, state: TextReadState): Promise<unknown> {
  return readPin(
    readerGraph(BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ_BY_ID, "isRead", { textId }),
    state
  );
}

/** `Has Read Text` with the id arriving through an edge from a String literal node. */
function readByWiredId(textId: string, state: TextReadState): Promise<unknown> {
  return readPin(
    readerGraph(
      BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ_BY_ID,
      "isRead",
      {},
      { id: { id: "id", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: textId } } },
      [{ from: { nodeId: "id", port: "value" }, to: { nodeId: "read", port: "textId" } }]
    ),
    state
  );
}

describe("Has Read Text blueprint node", () => {
  it("is registered, pure and non-latent, so a function graph still accepts it", () => {
    registerCoreBlueprintNodes();
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ_BY_ID);

    expect(def).toBeDefined();
    // Purity is a contract, not a detail: a voice EXTRA row binds this pin directly instead of
    // running a graph per row, and a function graph refuses latent or impure nodes.
    expect(def!.isPure).toBe(true);
    expect(def!.isLatent).toBeFalsy();
    expect(
      isBlueprintNodeAllowedInGraphContext(def!, {
        graphKind: "function",
        owner: { kind: "globalMain" }
      } as BlueprintPaletteContext)
    ).toBe(true);
  });

  it("reads true downstream for an id the player has read", async () => {
    const state: TextReadState = { read: ["voice-1"], current: false };

    await expect(readByInlineId("voice-1", state)).resolves.toBe(true);
    await expect(readByWiredId("voice-1", state)).resolves.toBe(true);
  });

  it("reads false downstream for an id the player has never read", async () => {
    const state: TextReadState = { read: ["voice-1"], current: true };

    // `current: true` above is the trap: if this node ever gets folded into the shared game
    // whitelist, the bare `isRead` port id answers `isCurrentTextRead()` and this flips to true.
    await expect(readByInlineId("voice-2", state)).resolves.toBe(false);
    await expect(readByWiredId("voice-2", state)).resolves.toBe(false);
  });

  it("reads false rather than undefined when no id is wired yet", async () => {
    // A half-wired EXTRA row must stay locked, not resolve to `undefined` and light up.
    const state: TextReadState = { read: ["voice-1"], current: true };

    await expect(readByInlineId(undefined, state)).resolves.toBe(false);
    await expect(readByInlineId("   ", state)).resolves.toBe(false);
  });

  it("keeps its sibling Is Text Read answering the current line", async () => {
    // The two nodes share the `isRead` port id and must not share an answer.
    const state: TextReadState = { read: [], current: true };

    await expect(
      readPin(readerGraph(BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ, "isRead", {}), state)
    ).resolves.toBe(true);
    await expect(readByInlineId("voice-1", state)).resolves.toBe(false);
  });
});
