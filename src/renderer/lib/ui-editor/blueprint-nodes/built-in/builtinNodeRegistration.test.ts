/**
 * Guard: every node array exported from `built-in/index.ts` must actually reach the registry.
 *
 * An array can be exported, imported by tests, and documented, yet never be spread into
 * `allBuiltinBlueprintNodes` - in which case `registerCoreBlueprintNodes()` skips it and the
 * nodes exist in neither the palette nor `behaviorNodeRegistry`. That failure is silent: the
 * only symptom is a saved graph throwing "Behavior node definition missing" at execution time.
 *
 * Membership is checked by node `type`, not by array identity, because some arrays are
 * re-exported for tests while shipping nested inside another (e.g. `imageAssetBlueprintNodes`
 * is spread into `widgetPropertyBlueprintNodes`).
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import * as builtins from "./index";
import { allBuiltinBlueprintNodes } from "./index";
import {
  blueprintNodeRegistry,
  isBlueprintNodeAllowedInGraphContext
} from "../BlueprintNodeRegistry";
import { behaviorNodeRegistry } from "../../behavior-graph/BehaviorNodeRegistry";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY } from "@shared/types/blueprint/graph";
import type { BlueprintNodeDef, BlueprintPaletteContext } from "../types";

function isBlueprintNodeDefArray(value: unknown): value is BlueprintNodeDef[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as BlueprintNodeDef).type === "string"
    )
  );
}

/** Every `*BlueprintNodes` array the barrel exports, excluding the aggregate itself. */
function listExportedNodeArrays(): Array<[string, BlueprintNodeDef[]]> {
  return Object.entries(builtins as Record<string, unknown>)
    .filter(([name]) => name.endsWith("BlueprintNodes") && name !== "allBuiltinBlueprintNodes")
    .filter((entry): entry is [string, BlueprintNodeDef[]] => isBlueprintNodeDefArray(entry[1]));
}

describe("built-in blueprint node registration", () => {
  it("exports at least one node array (guard is wired to the real barrel)", () => {
    expect(listExportedNodeArrays().length).toBeGreaterThan(0);
  });

  it("includes every exported node array in allBuiltinBlueprintNodes", () => {
    const registeredTypes = new Set(allBuiltinBlueprintNodes.map((def) => def.type));
    const missing = listExportedNodeArrays().flatMap(([name, defs]) => {
      const absent = defs.filter((def) => !registeredTypes.has(def.type)).map((def) => def.type);
      return absent.length > 0 ? [`${name}: ${absent.join(", ")}`] : [];
    });

    // A new node set was exported but never spread into `allBuiltinBlueprintNodes`.
    // Either add it there, or delete the set - do not leave it exported and unreachable.
    expect(missing).toEqual([]);
  });

  it("registers every exported node type into the runtime registries", () => {
    registerCoreBlueprintNodes();

    const unregistered = listExportedNodeArrays().flatMap(([name, defs]) => {
      const absent = defs
        .filter((def) => !blueprintNodeRegistry.get(def.type))
        .map((def) => def.type);
      return absent.length > 0 ? [`${name}: ${absent.join(", ")}`] : [];
    });

    expect(unregistered).toEqual([]);
  });
});

describe("function entry node", () => {
  function paletteContext(
    overrides: Partial<BlueprintPaletteContext> = {}
  ): BlueprintPaletteContext {
    return {
      graphKind: "function",
      owner: { kind: "globalMain" },
      ...overrides
    } as BlueprintPaletteContext;
  }

  it("is offered by the palette in an empty function graph", () => {
    registerCoreBlueprintNodes();
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY);

    expect(def).toBeDefined();
    expect(
      isBlueprintNodeAllowedInGraphContext(def!, paletteContext({ hasFunctionEntry: false }))
    ).toBe(true);
  });

  it("is refused once the function graph already has an entry", () => {
    registerCoreBlueprintNodes();
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY)!;

    expect(
      isBlueprintNodeAllowedInGraphContext(def, paletteContext({ hasFunctionEntry: true }))
    ).toBe(false);
  });

  it("is refused in an event graph", () => {
    registerCoreBlueprintNodes();
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY)!;

    expect(isBlueprintNodeAllowedInGraphContext(def, paletteContext({ graphKind: "event" }))).toBe(
      false
    );
  });

  it("resolves from behaviorNodeRegistry so the executor does not throw a missing definition", () => {
    registerCoreBlueprintNodes();

    // GraphExecutor throws `Behavior node definition missing: <type>` when this lookup returns
    // undefined, which is exactly what an unregistered entry node caused.
    const behavior = behaviorNodeRegistry.get(BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY);
    expect(behavior).toBeDefined();
    expect(behavior?.execute).toBeTypeOf("function");
  });
});
