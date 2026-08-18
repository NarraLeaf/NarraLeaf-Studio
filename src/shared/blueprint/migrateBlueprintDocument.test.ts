import { describe, expect, it } from "vitest";
import { encodeCanonicalJson } from "../documents/canonicalJson";
import type { BlueprintDocument, BlueprintGraphIndex } from "../types/blueprint/document";
import { listBlueprintEventIds, listBlueprintFunctionIds } from "./blueprintEventOrder";
import { migrateBlueprintDocumentToLatest } from "./migrateBlueprintDocument";
import {
  BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
  BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
  BLUEPRINT_NODE_TYPE_FLOW_DELAY,
  BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED
} from "../types/blueprint/graph";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "../types/blueprint/schema";
import { BLUEPRINT_NODE_TYPE_PERSISTENT_GET } from "../types/blueprint/graph";

describe("migrateBlueprintDocumentToLatest", () => {
  it("upgrades schema 6 documents and no longer carries persistentVariables (M-VAR)", () => {
    const migrated = migrateBlueprintDocumentToLatest({
      schemaVersion: 6,
      blueprints: {},
      ownerRecords: {}
    });

    expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    expect("persistentVariables" in migrated).toBe(false);
  });

  it("strips persistentVariables on the v8→v9 (M-VAR) migration and keeps matching node params", () => {
    const migrated = migrateBlueprintDocumentToLatest({
      schemaVersion: 8,
      ownerRecords: {},
      persistentVariables: {
        gold: { id: "gold", name: "Gold", valueType: "number", storageKey: "gold" }
      },
      blueprints: {
        bp: {
          id: "bp",
          name: "Main",
          owner: { kind: "globalMain" },
          frontend: "visual",
          programKind: "graph",
          program: {
            kind: "graph",
            graphs: {
              events: {
                onCall: {
                  id: "onCall",
                  graph: {
                    nodes: {
                      get: {
                        id: "get",
                        type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                        params: { persistentVariableId: "gold" }
                      }
                    },
                    edges: []
                  }
                }
              },
              functions: {}
            }
          }
        }
      }
    });

    expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    expect("persistentVariables" in migrated).toBe(false);
    // id === storageKey, so the node param resolves to the registry entry unchanged.
    const graph =
      migrated.blueprints.bp?.program.kind === "graph"
        ? migrated.blueprints.bp.program.graphs.events.onCall?.graph
        : undefined;
    expect(graph?.nodes?.get.params?.persistentVariableId).toBe("gold");
  });

  it("remaps persistentVariableId when the old blueprint id differs from the storage key", () => {
    const migrated = migrateBlueprintDocumentToLatest({
      schemaVersion: 8,
      ownerRecords: {},
      persistentVariables: {
        bp_old_id: {
          id: "bp_old_id",
          name: "Gold",
          valueType: "number",
          storageKey: "storage_gold"
        }
      },
      blueprints: {
        bp: {
          id: "bp",
          name: "Main",
          owner: { kind: "globalMain" },
          frontend: "visual",
          programKind: "graph",
          program: {
            kind: "graph",
            graphs: {
              events: {
                onCall: {
                  id: "onCall",
                  graph: {
                    nodes: {
                      get: {
                        id: "get",
                        type: BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
                        params: { persistentVariableId: "bp_old_id" }
                      }
                    },
                    edges: []
                  }
                }
              },
              functions: {}
            }
          }
        }
      }
    });

    const graph =
      migrated.blueprints.bp?.program.kind === "graph"
        ? migrated.blueprints.bp.program.graphs.events.onCall?.graph
        : undefined;
    // The registry keys the entry by storageKey; the node param is remapped to match.
    expect(graph?.nodes?.get.params?.persistentVariableId).toBe("storage_gold");
  });

  it("converts legacy blueprint timing node params from milliseconds to seconds", () => {
    const migrated = migrateBlueprintDocumentToLatest({
      schemaVersion: 7,
      ownerRecords: {},
      persistentVariables: {},
      blueprints: {
        bp: {
          id: "bp",
          name: "Widget",
          owner: { kind: "widgetMain", surfaceId: "surface", elementId: "image" },
          frontend: "visual",
          programKind: "graph",
          program: {
            kind: "graph",
            graphs: {
              events: {
                init: {
                  id: "init",
                  graph: {
                    nodes: {
                      delay: {
                        id: "delay",
                        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
                        params: { duration: 1000 }
                      },
                      animate: {
                        id: "animate",
                        type: BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
                        params: {
                          property: "opacity",
                          durationMs: 300,
                          delayMs: 50
                        }
                      },
                      animateElement: {
                        id: "animateElement",
                        type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
                        params: {
                          property: "opacity",
                          durationMs: 1500,
                          delayMs: 0
                        }
                      }
                    },
                    edges: []
                  }
                }
              },
              functions: {}
            }
          }
        }
      }
    });

    const graph =
      migrated.blueprints.bp?.program.kind === "graph"
        ? migrated.blueprints.bp.program.graphs.events.init?.graph
        : undefined;
    const delay = graph?.nodes?.delay.params;
    const animate = graph?.nodes?.animate.params;
    const animateElement = graph?.nodes?.animateElement.params;

    expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    expect(delay).toMatchObject({ duration: 1 });
    expect(animate).toMatchObject({ property: "opacity", duration: 0.3, delay: 0.05 });
    expect(animate).not.toHaveProperty("durationMs");
    expect(animate).not.toHaveProperty("delayMs");
    expect(animateElement).toMatchObject({ property: "opacity", duration: 1.5, delay: 0 });
    expect(animateElement).not.toHaveProperty("durationMs");
    expect(animateElement).not.toHaveProperty("delayMs");
  });

  it("renames Set Sentence Speed input semantics from speed to cps", () => {
    const migrated = migrateBlueprintDocumentToLatest({
      schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
      ownerRecords: {},
      persistentVariables: {},
      blueprints: {
        bp: {
          id: "bp",
          name: "Widget",
          owner: { kind: "widgetMain", surfaceId: "surface", elementId: "text" },
          frontend: "visual",
          programKind: "graph",
          program: {
            kind: "graph",
            graphs: {
              events: {
                init: {
                  id: "init",
                  graph: {
                    nodes: {
                      literal: {
                        id: "literal",
                        type: "blueprint.literal.float",
                        params: { value: 24 }
                      },
                      setSpeed: {
                        id: "setSpeed",
                        type: BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED,
                        params: { speed: 24 },
                        ports: {
                          speed: { kind: "input", type: "float", label: "Speed" }
                        }
                      }
                    },
                    edges: [
                      {
                        from: { nodeId: "literal", port: "value" },
                        to: { nodeId: "setSpeed", port: "speed" }
                      }
                    ]
                  }
                }
              },
              functions: {},
              macros: {}
            }
          }
        }
      }
    });

    const graph =
      migrated.blueprints.bp?.program.kind === "graph"
        ? migrated.blueprints.bp.program.graphs.events.init?.graph
        : undefined;
    const setSpeed = graph?.nodes?.setSpeed;

    expect(setSpeed?.params).toMatchObject({ cps: 24 });
    expect(setSpeed?.params).not.toHaveProperty("speed");
    expect(setSpeed?.ports).toMatchObject({ cps: { kind: "input", type: "float", label: "CPS" } });
    expect(setSpeed?.ports).not.toHaveProperty("speed");
    expect(graph?.edges?.[0]?.to).toEqual({ nodeId: "setSpeed", port: "cps" });
  });
});

describe("migrateBlueprintDocumentToLatest (v9→v10 graph-slot order)", () => {
  /** Ids chosen so alphabetical order and authored order are different lists. */
  const AUTHORED = ["zeta", "alpha", "mid"];
  const AUTHORED_FNS = ["yield", "banner", "nudge"];

  function slots(ids: string[]): Record<string, unknown> {
    return Object.fromEntries(
      ids.map((id) => [id, { id, name: id, graph: { nodes: {}, edges: [] } }])
    );
  }

  function documentText(
    schemaVersion: number,
    stale?: { eventIds?: string[]; functionIds?: string[] }
  ): string {
    return JSON.stringify({
      schemaVersion,
      ownerRecords: {},
      blueprints: {
        bp: {
          id: "bp",
          name: "Main",
          owner: { kind: "globalMain" },
          frontend: "visual",
          programKind: "graph",
          program: {
            kind: "graph",
            graphs: {
              ...(stale?.eventIds ? { eventIds: stale.eventIds } : {}),
              events: slots(AUTHORED),
              ...(stale?.functionIds ? { functionIds: stale.functionIds } : {}),
              functions: slots(AUTHORED_FNS)
            }
          }
        }
      }
    });
  }

  function graphsOf(doc: BlueprintDocument): BlueprintGraphIndex {
    const bp = doc.blueprints.bp;
    if (!bp || bp.program.kind !== "graph") {
      throw new Error("test fixture lost its graph program");
    }
    return bp.program.graphs;
  }

  it("derives the order from the parsed key order of a v9 document", () => {
    const migrated = migrateBlueprintDocumentToLatest(JSON.parse(documentText(9)));

    expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
    expect(graphsOf(migrated).eventIds).toEqual(AUTHORED);
    expect(graphsOf(migrated).functionIds).toEqual(AUTHORED_FNS);
  });

  it("keeps the authored order across a canonical write, which reorders the records themselves", () => {
    // The whole point of the milestone in one test: the records come back sorted, and the
    // slot lists do not follow them. Populate the arrays any later than the parse and these
    // assertions are the sorted lists, with no way left to tell that they are wrong.
    const migrated = migrateBlueprintDocumentToLatest(JSON.parse(documentText(9)));
    const reread = JSON.parse(encodeCanonicalJson(migrated)) as BlueprintDocument;

    expect(Object.keys(graphsOf(reread).events)).toEqual(["alpha", "mid", "zeta"]);
    expect(Object.keys(graphsOf(reread).functions)).toEqual(["banner", "nudge", "yield"]);
    expect(listBlueprintEventIds(graphsOf(reread))).toEqual(AUTHORED);
    expect(listBlueprintFunctionIds(graphsOf(reread))).toEqual(AUTHORED_FNS);
  });

  it("is a no-op on an already-migrated document", () => {
    const once = migrateBlueprintDocumentToLatest(JSON.parse(documentText(9)));
    const twice = migrateBlueprintDocumentToLatest(JSON.parse(JSON.stringify(once)));

    expect(graphsOf(twice).eventIds).toEqual(AUTHORED);
    expect(encodeCanonicalJson(twice)).toBe(encodeCanonicalJson(once));
  });

  it("does not throw on a current-version document that is missing the field", () => {
    // Reachable through a hand-edited file, or a blueprint pasted in from an older export.
    const migrated = migrateBlueprintDocumentToLatest(
      JSON.parse(documentText(BLUEPRINT_DOCUMENT_SCHEMA_VERSION))
    );

    expect(graphsOf(migrated).eventIds).toEqual(AUTHORED);
    expect(graphsOf(migrated).functionIds).toEqual(AUTHORED_FNS);
  });

  it("drops a listed slot that is gone and appends one that was never listed", () => {
    const migrated = migrateBlueprintDocumentToLatest(
      JSON.parse(
        documentText(BLUEPRINT_DOCUMENT_SCHEMA_VERSION, {
          eventIds: ["mid", "deleted-elsewhere", "zeta"],
          functionIds: ["nudge", "deleted-elsewhere", "yield"]
        })
      )
    );

    expect(graphsOf(migrated).eventIds).toEqual(["mid", "zeta", "alpha"]);
    expect(graphsOf(migrated).functionIds).toEqual(["nudge", "yield", "banner"]);
  });

  it("upgrades a v9 document that has no blueprints at all", () => {
    const migrated = migrateBlueprintDocumentToLatest({
      schemaVersion: 9,
      blueprints: {},
      ownerRecords: {}
    });

    expect(migrated.schemaVersion).toBe(BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
  });
});
