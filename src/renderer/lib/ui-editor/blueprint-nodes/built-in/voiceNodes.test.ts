/**
 * Voice nodes. Every one of them is latent and publishes through `execute()`'s `outputValues`, so
 * the assertions read the output pin from a *downstream* node - that is the read path that silently
 * yields `undefined` when a node type is missing on the resolver side (`graphParamResolvers.ts`).
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_NODE_TYPE_LITERAL_STRING,
  BLUEPRINT_NODE_TYPE_LOCAL_SET,
  BLUEPRINT_NODE_TYPE_VOICE_GET_AVAILABLE_LANGUAGES,
  BLUEPRINT_NODE_TYPE_VOICE_GET_LANGUAGE,
  BLUEPRINT_NODE_TYPE_VOICE_PLAY,
  BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { VoiceLocaleEntry } from "@shared/types/voice";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

const LOCALES: VoiceLocaleEntry[] = [
  { code: "ja", displayName: "日本語" },
  { code: "en", displayName: "English" }
];

type VoiceHost = {
  locale: string;
  locales?: VoiceLocaleEntry[];
  setCalls: string[];
  playCalls: string[];
  /** Unit ids that have a take in the current dub language. */
  playable?: string[];
};

function createVoiceHostAdapter(host: VoiceHost): UIHostAdapter {
  return {
    host: "player",
    blueprintRuntime: {
      surfaceId: "surface",
      setSurfaceState: () => undefined,
      getSurfaceState: () => undefined,
      emitDebug: () => undefined,
      dispatchElementBlueprintEvent: async () => undefined,
      hostApi: {
        voice: {
          listLocales: () => host.locales ?? LOCALES,
          getLocale: async () => host.locale,
          setLocale: async (code: string) => {
            host.setCalls.push(code);
            host.locale = code;
          },
          play: async (unitId: string) => {
            host.playCalls.push(unitId);
            return (host.playable ?? ["t-1"]).includes(unitId);
          }
        }
      }
    }
  } as unknown as UIHostAdapter;
}

async function runGraph(graph: UIGraph, host: VoiceHost): Promise<Record<string, unknown>> {
  const locals: Record<string, unknown> = {};
  await executeGraph({
    graph,
    entry: graph.entries.main,
    hostAdapter: createVoiceHostAdapter(host),
    blueprintLocals: locals
  });
  return locals;
}

/** Single node whose data output pin feeds a Set Var named `out`. */
function captureOutputGraph(
  nodeType: string,
  outputPortId: string,
  params: Record<string, unknown> = {}
): UIGraph {
  return {
    id: "capture",
    entries: { main: { start: { nodeId: "get", port: "in" } } },
    nodes: {
      get: { id: "get", type: nodeType, params },
      store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
    },
    edges: [
      { from: { nodeId: "get", port: "next" }, to: { nodeId: "store", port: "in" } },
      { from: { nodeId: "get", port: outputPortId }, to: { nodeId: "store", port: "value" } }
    ]
  } as UIGraph;
}

/** A node with one string input wired from a literal. */
function stringInputGraph(
  nodeType: string,
  inputPortId: string,
  value: string,
  outputPortId?: string
): UIGraph {
  const graph = {
    id: "input",
    entries: { main: { start: { nodeId: "act", port: "in" } } },
    nodes: {
      act: { id: "act", type: nodeType, params: {} },
      literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value } },
      store: { id: "store", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "out" } }
    },
    edges: [
      { from: { nodeId: "literal", port: "value" }, to: { nodeId: "act", port: inputPortId } },
      { from: { nodeId: "act", port: "next" }, to: { nodeId: "store", port: "in" } }
    ]
  } as UIGraph;
  if (outputPortId) {
    graph.edges.push({
      from: { nodeId: "act", port: outputPortId },
      to: { nodeId: "store", port: "value" }
    });
  }
  return graph;
}

describe("Voice blueprint nodes", () => {
  it("publishes Get Voice Language to a downstream data pin", async () => {
    const locals = await runGraph(
      captureOutputGraph(BLUEPRINT_NODE_TYPE_VOICE_GET_LANGUAGE, "value"),
      { locale: "ja", setCalls: [], playCalls: [] }
    );
    expect(locals).toMatchObject({ out: "ja" });
  });

  it("publishes the dub languages this build ships", async () => {
    const locals = await runGraph(
      captureOutputGraph(BLUEPRINT_NODE_TYPE_VOICE_GET_AVAILABLE_LANGUAGES, "value"),
      { locale: "ja", setCalls: [], playCalls: [] }
    );
    expect(locals.out).toEqual([
      { code: "ja", displayName: "日本語" },
      { code: "en", displayName: "English" }
    ]);
  });

  it("persists a dub choice the build ships", async () => {
    const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
    await runGraph(
      stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE, "language", "en"),
      host
    );
    expect(host.setCalls).toEqual(["en"]);
    expect(host.locale).toBe("en");
  });

  it("refuses a dub language the build does not ship", async () => {
    const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
    await expect(
      runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE, "language", "fr"), host)
    ).rejects.toThrow(/fr/);
    expect(host.setCalls).toEqual([]);
  });

  it("refuses to set a language on a project with no voice at all", async () => {
    const host: VoiceHost = { locale: "", locales: [], setCalls: [], playCalls: [] };
    await expect(
      runGraph(stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_SET_LANGUAGE, "language", "ja"), host)
    ).rejects.toThrow(/no voice languages/i);
  });

  it("plays a take by voice unit id and reports whether it played", async () => {
    const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
    expect(
      await runGraph(
        stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_PLAY, "voiceId", "t-1", "value"),
        host
      )
    ).toMatchObject({ out: true });
    expect(host.playCalls).toEqual(["t-1"]);
  });

  /**
   * A backlog row for an unvoiced line is normal, not an error: the graph keeps running and the
   * `Played` pin is what a UI hides its replay button on.
   */
  it("reports false rather than throwing for a line with no take", async () => {
    const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
    expect(
      await runGraph(
        stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_PLAY, "voiceId", "t-9", "value"),
        host
      )
    ).toMatchObject({ out: false });
  });

  it("treats an empty voice id as nothing to play, without calling the host", async () => {
    const host: VoiceHost = { locale: "ja", setCalls: [], playCalls: [] };
    expect(
      await runGraph(
        stringInputGraph(BLUEPRINT_NODE_TYPE_VOICE_PLAY, "voiceId", "   ", "value"),
        host
      )
    ).toMatchObject({ out: false });
    expect(host.playCalls).toEqual([]);
  });
});
