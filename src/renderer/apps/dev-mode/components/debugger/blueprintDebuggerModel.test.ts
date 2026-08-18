import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import {
  evaluateBlueprintBreakpointCondition,
  parseBlueprintBreakpointTable
} from "@shared/types/blueprint/breakpoints";
import {
  buildBlueprintRunGraphId,
  isPausableBlueprintRunGraphKind,
  parseBlueprintRunGraphId
} from "@shared/blueprint/blueprintRunGraphId";
import { listDevModeBlueprints } from "../blueprintDebugPanelModel";
import { MAX_DEBUG_VALUE_CHARS, formatDebugValue } from "../debugValueFormat";
import { groupBreakpointsByBlueprint, resolveBlueprintGraphIr } from "./blueprintDebuggerModel";

/** The debugger's half of the one listing function: "what can I set a breakpoint in". */
function listDebuggable(document: BlueprintDocument) {
  return listDevModeBlueprints(document.blueprints, { purpose: "breakpoints" });
}

function graphBlueprint(
  overrides: Partial<Blueprint> & Pick<Blueprint, "id" | "name" | "owner">
): Blueprint {
  return {
    frontend: "visual",
    programKind: "graph",
    program: {
      kind: "graph",
      graphs: { events: {}, functions: {}, macros: {} }
    },
    ...overrides
  } as Blueprint;
}

function documentOf(...blueprints: Blueprint[]): BlueprintDocument {
  return {
    blueprints: Object.fromEntries(blueprints.map((blueprint) => [blueprint.id, blueprint]))
  } as unknown as BlueprintDocument;
}

const withNodes = (id: string, name: string, nodeIds: string[]) => ({
  id,
  name,
  graph: {
    nodes: Object.fromEntries(nodeIds.map((node) => [node, { id: node, type: "test.node" }]))
  }
});

describe("run graph ids", () => {
  it("round-trips kind, blueprint and graph", () => {
    const id = buildBlueprintRunGraphId("fnCall", "bp-1", "graph-9");
    expect(parseBlueprintRunGraphId(id)).toEqual({
      kind: "fnCall",
      blueprintId: "bp-1",
      graphId: "graph-9"
    });
  });

  it("refuses anything it did not build", () => {
    expect(parseBlueprintRunGraphId("not-a-run-graph")).toBeNull();
    expect(parseBlueprintRunGraphId("only:two")).toBeNull();
    expect(parseBlueprintRunGraphId(undefined)).toBeNull();
  });

  it("knows which kinds can never stop", () => {
    expect(isPausableBlueprintRunGraphKind("blueprintEvent")).toBe(true);
    expect(isPausableBlueprintRunGraphKind("storyActionValue")).toBe(false);
  });
});

describe("breakpoint table", () => {
  it("drops entries it cannot trust and de-duplicates by node", () => {
    const table = parseBlueprintBreakpointTable({
      version: 1,
      breakpoints: [
        { blueprintId: "a", graphId: "g", nodeId: "n1", enabled: true },
        { blueprintId: "a", graphId: "g", nodeId: "n1", enabled: false },
        { blueprintId: "a", graphId: "g" },
        { nodeId: "n2" },
        null
      ]
    });
    expect(table.breakpoints).toEqual([
      { blueprintId: "a", graphId: "g", nodeId: "n1", enabled: true }
    ]);
  });

  it("reads an unknown version as no breakpoints", () => {
    expect(parseBlueprintBreakpointTable({ version: 2, breakpoints: [{}] }).breakpoints).toEqual(
      []
    );
    expect(parseBlueprintBreakpointTable(undefined).breakpoints).toEqual([]);
  });

  it("keeps a condition only when every part of it is valid", () => {
    const table = parseBlueprintBreakpointTable({
      version: 1,
      breakpoints: [
        {
          blueprintId: "a",
          graphId: "g",
          nodeId: "ok",
          enabled: true,
          condition: { variableId: "hp", op: "<", value: 5 }
        },
        {
          blueprintId: "a",
          graphId: "g",
          nodeId: "badOp",
          enabled: true,
          condition: { variableId: "hp", op: "~=", value: 5 }
        },
        {
          blueprintId: "a",
          graphId: "g",
          nodeId: "badValue",
          enabled: true,
          condition: { variableId: "hp", op: "<", value: {} }
        }
      ]
    });
    expect(table.breakpoints.map((entry) => [entry.nodeId, Boolean(entry.condition)])).toEqual([
      ["ok", true],
      ["badOp", false],
      ["badValue", false]
    ]);
  });

  it("ignores a hit count that is not a real threshold", () => {
    const table = parseBlueprintBreakpointTable({
      version: 1,
      breakpoints: [
        { blueprintId: "a", graphId: "g", nodeId: "n", enabled: true, hitCountTarget: 1 },
        { blueprintId: "a", graphId: "g", nodeId: "m", enabled: true, hitCountTarget: 3.7 }
      ]
    });
    expect(table.breakpoints[0].hitCountTarget).toBeUndefined();
    expect(table.breakpoints[1].hitCountTarget).toBe(3);
  });
});

describe("breakpoint conditions", () => {
  it("compares what the author sees rather than what the runtime stores", () => {
    expect(evaluateBlueprintBreakpointCondition({ variableId: "v", op: "==", value: 3 }, "3")).toBe(
      true
    );
    expect(evaluateBlueprintBreakpointCondition({ variableId: "v", op: "!=", value: 3 }, 4)).toBe(
      true
    );
    expect(
      evaluateBlueprintBreakpointCondition({ variableId: "v", op: ">=", value: 3 }, "10")
    ).toBe(true);
    expect(evaluateBlueprintBreakpointCondition({ variableId: "v", op: "<", value: 3 }, true)).toBe(
      true
    );
  });

  it("reads undecidable as false rather than throwing", () => {
    expect(
      evaluateBlueprintBreakpointCondition({ variableId: "v", op: ">", value: 3 }, undefined)
    ).toBe(false);
    expect(
      evaluateBlueprintBreakpointCondition({ variableId: "v", op: ">", value: 3 }, "abc")
    ).toBe(false);
    expect(
      evaluateBlueprintBreakpointCondition({ variableId: "v", op: "==", value: 3 }, { a: 1 })
    ).toBe(false);
  });

  it("handles contains for both lists and text", () => {
    expect(
      evaluateBlueprintBreakpointCondition({ variableId: "v", op: "contains", value: "b" }, [
        "a",
        "b"
      ])
    ).toBe(true);
    expect(
      evaluateBlueprintBreakpointCondition(
        { variableId: "v", op: "contains", value: "ell" },
        "hello"
      )
    ).toBe(true);
    expect(
      evaluateBlueprintBreakpointCondition({ variableId: "v", op: "contains", value: "z" }, 42)
    ).toBe(false);
  });
});

describe("debuggable blueprints", () => {
  const withGraphs = graphBlueprint({
    id: "bp-a",
    name: "Alpha",
    owner: { kind: "globalMain" },
    program: {
      kind: "graph",
      graphs: {
        events: { e1: withNodes("e1", "On Click", ["n1"]) },
        functions: { f1: withNodes("f1", "Helper", ["n2"]) },
        macros: {}
      }
    }
  } as never);
  const emptyGraphs = graphBlueprint({
    id: "bp-b",
    name: "Beta",
    owner: { kind: "globalMain" },
    program: {
      kind: "graph",
      graphs: {
        events: { e0: { id: "e0", name: "Empty", graph: { nodes: {} } } },
        functions: {},
        macros: {}
      }
    }
  } as never);
  const scriptModule = graphBlueprint({
    id: "bp-c",
    name: "Gamma",
    owner: { kind: "globalMain" },
    frontend: "typescript",
    program: { kind: "scriptModule", source: "" }
  } as never);

  it("lists only graph blueprints that have nodes to stop in", () => {
    const listed = listDebuggable(documentOf(withGraphs, emptyGraphs, scriptModule));
    expect(listed.map((entry) => entry.id)).toEqual(["bp-a"]);
    expect(listed[0].graphs.map((graph) => [graph.name, graph.kind])).toEqual([
      ["Helper", "function"],
      ["On Click", "event"]
    ]);
  });

  it("marks inline value blueprints as never stopping", () => {
    const inlineValue = graphBlueprint({
      id: "bp-v",
      name: "Inline",
      owner: { kind: "storyAction", blueprintId: "bp-v", mode: "value" },
      program: {
        kind: "graph",
        graphs: { events: { e1: withNodes("e1", "On Call", ["n1"]) }, functions: {}, macros: {} }
      }
    } as never);
    expect(listDebuggable(documentOf(inlineValue))[0].syncOnly).toBe(true);
  });

  it("resolves a graph's IR from either table", () => {
    const document = documentOf(withGraphs);
    expect(Object.keys(resolveBlueprintGraphIr(document, "bp-a", "e1")?.nodes ?? {})).toEqual([
      "n1"
    ]);
    expect(Object.keys(resolveBlueprintGraphIr(document, "bp-a", "f1")?.nodes ?? {})).toEqual([
      "n2"
    ]);
    expect(resolveBlueprintGraphIr(document, "bp-a", "missing")).toBeUndefined();
    expect(resolveBlueprintGraphIr(document, undefined, "e1")).toBeUndefined();
  });

  it("groups breakpoints under the blueprint they sit in", () => {
    const groups = groupBreakpointsByBlueprint(
      [
        { blueprintId: "bp-a", graphId: "e1", nodeId: "n2", enabled: true },
        { blueprintId: "bp-a", graphId: "e1", nodeId: "n1", enabled: true },
        { blueprintId: "gone", graphId: "g", nodeId: "x", enabled: true }
      ],
      documentOf(withGraphs)
    );
    expect(groups.map((group) => group.blueprintName)).toEqual(["Alpha", "gone"]);
    expect(groups[0].breakpoints.map((entry) => entry.nodeId)).toEqual(["n1", "n2"]);
  });
});

describe("scope values", () => {
  it("prints something short for every shape", () => {
    expect(formatDebugValue(undefined)).toBe("undefined");
    expect(formatDebugValue(null)).toBe("null");
    expect(formatDebugValue("hi")).toBe('"hi"');
    expect(formatDebugValue(7)).toBe("7");
    expect(formatDebugValue({ a: 1 })).toBe('{"a":1}');
    expect(formatDebugValue(() => undefined)).toBe("ƒ()");
    // Pinned to the shared limit, not to a loose upper bound: this used to be one of two
    // truncation lengths, and "under 200" passed for both of them.
    expect(formatDebugValue("x".repeat(400))).toHaveLength(MAX_DEBUG_VALUE_CHARS + 1);
  });

  it("quotes a string so an empty one and a trailing space are visible", () => {
    expect(formatDebugValue("")).toBe('""');
    expect(formatDebugValue("done ")).toBe('"done "');
    // A number-shaped string is not a number - the one distinction a raw passthrough erased.
    expect(formatDebugValue("5")).toBe('"5"');
  });

  it("survives a value that cannot be serialized", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatDebugValue(cyclic)).toBe("[unserializable]");
  });
});
