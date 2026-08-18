import { describe, expect, it } from "vitest";
import type { BlueprintEventGraph, BlueprintGraphIndex } from "../types/blueprint/document";
import {
  captureBlueprintDocumentEventOrder,
  captureBlueprintDocumentFunctionOrder,
  captureBlueprintEventOrder,
  captureBlueprintFunctionOrder,
  listBlueprintEventIds,
  listBlueprintFunctionIds
} from "./blueprintEventOrder";

function layers(...ids: string[]): Record<string, BlueprintEventGraph> {
  const out: Record<string, BlueprintEventGraph> = {};
  for (const id of ids) {
    out[id] = { id };
  }
  return out;
}

function graphs(
  events: Record<string, BlueprintEventGraph>,
  eventIds?: string[]
): BlueprintGraphIndex {
  return { ...(eventIds ? { eventIds } : {}), events, functions: {} };
}

describe("listBlueprintEventIds", () => {
  it("falls back to record key order when nothing is listed", () => {
    // The pre-v10 case. Key order is still the authored order at that point, so this is
    // the answer that preserves it rather than a default that discards it.
    expect(listBlueprintEventIds(graphs(layers("zeta", "alpha", "mid")))).toEqual([
      "zeta",
      "alpha",
      "mid"
    ]);
  });

  it("follows eventIds when it agrees with the record", () => {
    const index = graphs(layers("alpha", "mid", "zeta"), ["zeta", "alpha", "mid"]);
    expect(listBlueprintEventIds(index)).toEqual(["zeta", "alpha", "mid"]);
  });

  it("drops an id listed with no layer behind it", () => {
    // A layer deleted by something that did not update the array. Kept, a stale id in
    // first position would make the editor open a layer that does not exist.
    const index = graphs(layers("a", "c"), ["a", "ghost", "c"]);
    expect(listBlueprintEventIds(index)).toEqual(["a", "c"]);
  });

  it("appends a layer that no id lists rather than hiding it", () => {
    // The opposite staleness: a layer added without updating the array. Wrong position is
    // cosmetic; dropping it would look like Studio deleted the author's work.
    const index = graphs(layers("a", "b", "c"), ["c", "a"]);
    expect(listBlueprintEventIds(index)).toEqual(["c", "a", "b"]);
  });

  it("reconciles both kinds of staleness at once, appending in record key order", () => {
    const index = graphs(layers("a", "b", "c"), ["c", "ghost", "a"]);
    expect(listBlueprintEventIds(index)).toEqual(["c", "a", "b"]);
  });

  it("keeps the first occurrence of a repeated id", () => {
    const index = graphs(layers("a", "b"), ["b", "a", "b"]);
    expect(listBlueprintEventIds(index)).toEqual(["b", "a"]);
  });

  it("does not resolve a listed id through Object.prototype", () => {
    // "constructor" is a legal layer id, so `id in events` would list a layer that is not
    // there and shift every real one down by a row.
    const index = graphs(layers("a"), ["constructor", "a"]);
    expect(listBlueprintEventIds(index)).toEqual(["a"]);
  });

  it("lists a layer genuinely keyed with a prototype name", () => {
    const index = graphs(layers("constructor", "a"), ["constructor", "a"]);
    expect(listBlueprintEventIds(index)).toEqual(["constructor", "a"]);
  });

  it("ignores a malformed carrier instead of throwing", () => {
    expect(listBlueprintEventIds(undefined)).toEqual([]);
    expect(listBlueprintEventIds(null)).toEqual([]);
    expect(listBlueprintEventIds({ events: "not an object" })).toEqual([]);
    expect(listBlueprintEventIds({ events: layers("a"), eventIds: "not an array" })).toEqual(["a"]);
    expect(listBlueprintEventIds({ events: layers("a", "b"), eventIds: [7, null, "b"] })).toEqual([
      "b",
      "a"
    ]);
  });
});

describe("captureBlueprintEventOrder", () => {
  it("writes the reconciled order and is a no-op on a second pass", () => {
    const index = graphs(layers("a", "b", "c"), ["c", "ghost"]);
    captureBlueprintEventOrder(index);
    expect(index.eventIds).toEqual(["c", "a", "b"]);

    captureBlueprintEventOrder(index);
    expect(index.eventIds).toEqual(["c", "a", "b"]);
  });
});

describe("listBlueprintFunctionIds", () => {
  // The rule is shared with events and pinned above; these cover that `functions` is wired
  // to it at all, in both stale directions.
  function fnGraphs(ids: string[], functionIds?: string[]): BlueprintGraphIndex {
    return { ...(functionIds ? { functionIds } : {}), events: {}, functions: layers(...ids) };
  }

  it("falls back to record key order when nothing is listed", () => {
    expect(listBlueprintFunctionIds(fnGraphs(["zeta", "alpha"]))).toEqual(["zeta", "alpha"]);
  });

  it("drops a listed graph that is gone and appends one that was never listed", () => {
    expect(listBlueprintFunctionIds(fnGraphs(["a", "b", "c"], ["c", "ghost", "a"]))).toEqual([
      "c",
      "a",
      "b"
    ]);
  });

  it("does not read the event order by mistake", () => {
    const index: BlueprintGraphIndex = {
      eventIds: ["e2", "e1"],
      events: layers("e1", "e2"),
      functionIds: ["f2", "f1"],
      functions: layers("f1", "f2")
    };

    expect(listBlueprintEventIds(index)).toEqual(["e2", "e1"]);
    expect(listBlueprintFunctionIds(index)).toEqual(["f2", "f1"]);
  });
});

describe("captureBlueprintFunctionOrder", () => {
  it("writes the reconciled order without disturbing the event order", () => {
    const index: BlueprintGraphIndex = {
      eventIds: ["e2", "e1"],
      events: layers("e1", "e2"),
      functions: layers("f1", "f2")
    };

    captureBlueprintFunctionOrder(index);

    expect(index.functionIds).toEqual(["f1", "f2"]);
    expect(index.eventIds).toEqual(["e2", "e1"]);
  });
});

describe("captureBlueprintDocumentEventOrder", () => {
  it("captures every graph program and leaves script modules alone", () => {
    const raw = {
      blueprints: {
        visual: {
          program: { kind: "graph", graphs: { events: layers("zeta", "alpha"), functions: {} } }
        },
        script: { program: { kind: "scriptModule", source: { language: "typescript", code: "" } } }
      }
    };

    captureBlueprintDocumentEventOrder(raw);

    expect((raw.blueprints.visual.program.graphs as BlueprintGraphIndex).eventIds).toEqual([
      "zeta",
      "alpha"
    ]);
    expect(raw.blueprints.script.program).not.toHaveProperty("graphs");
  });

  it("leaves functionIds alone, and the function pass leaves eventIds alone", () => {
    const graphIndex = { events: layers("zeta", "alpha"), functions: layers("fb", "fa") };
    const raw = { blueprints: { visual: { program: { kind: "graph", graphs: graphIndex } } } };

    captureBlueprintDocumentEventOrder(raw);
    expect(graphIndex).not.toHaveProperty("functionIds");

    captureBlueprintDocumentFunctionOrder(raw);
    expect((graphIndex as BlueprintGraphIndex).eventIds).toEqual(["zeta", "alpha"]);
    expect((graphIndex as BlueprintGraphIndex).functionIds).toEqual(["fb", "fa"]);
  });

  it("does not invent a functions carrier on a program that has no functions record", () => {
    const graphIndex = { events: layers("a") };
    captureBlueprintDocumentFunctionOrder({
      blueprints: { visual: { program: { graphs: graphIndex } } }
    });
    expect(graphIndex).not.toHaveProperty("functionIds");
  });

  it("survives shapes it does not recognise", () => {
    // Version dispatch reports a bad document with a message worth reading; an order pass
    // throwing first would turn one odd blueprint into a project that will not open.
    expect(() => captureBlueprintDocumentEventOrder(undefined)).not.toThrow();
    expect(() => captureBlueprintDocumentEventOrder({ blueprints: "nope" })).not.toThrow();
    expect(() => captureBlueprintDocumentEventOrder({ blueprints: { a: null } })).not.toThrow();
    expect(() =>
      captureBlueprintDocumentEventOrder({ blueprints: { a: { program: {} } } })
    ).not.toThrow();
    expect(() =>
      captureBlueprintDocumentEventOrder({
        blueprints: { a: { program: { graphs: { events: 3 } } } }
      })
    ).not.toThrow();
  });
});
