import { describe, expect, it } from "vitest";
import { blueprintSource, extractBlueprintEntries } from "./blueprintSource";
import { dedupSearchEntries } from "../searchSource";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { BlueprintDocument } from "@shared/types/blueprint/document";

function blueprintDoc(): BlueprintDocument {
  return {
    schemaVersion: 1,
    ownerRecords: {
      globalMain: { activeBlueprintId: "bp-global", privateBlueprintIds: ["bp-global"] },
      "surfaceMain:surf-1": { activeBlueprintId: "bp-1", privateBlueprintIds: ["bp-1"] }
    },
    blueprints: {
      "bp-global": {
        id: "bp-global",
        name: "Global",
        owner: {} as never,
        frontend: "graph",
        programKind: "graph",
        program: { kind: "graph", graphs: { events: {}, functions: {} } }
      },
      "bp-1": {
        id: "bp-1",
        name: "Main Menu Logic",
        owner: {} as never,
        frontend: "graph",
        programKind: "graph",
        members: {
          variables: { mv1: { id: "mv1", name: "Menu Open" } as never },
          fields: {}
        },
        program: {
          kind: "graph",
          graphs: {
            events: {
              "ev-1": {
                name: "On Click",
                graph: {
                  nodes: {
                    n1: { id: "n1", type: "flow.branch" },
                    // Three of a kind: two indistinguishable, one carrying a literal.
                    s1: { id: "s1", type: "image.setAsset" },
                    s2: { id: "s2", type: "image.setAsset" },
                    s3: {
                      id: "s3",
                      type: "image.setAsset",
                      params: {
                        slot: 3,
                        loop: true,
                        assetId: "6f1c9a2e-2b7d-4c5e-9a10-77b3c0d1e2f4",
                        label: "forest at dusk",
                        note: "second pass"
                      }
                    }
                  }
                }
              } as never,
              // A sibling layer with the SAME name — the shape that survived a
              // per-graph dedup and put four identical rows on screen.
              "ev-2": {
                name: "On Click",
                graph: { nodes: { s4: { id: "s4", type: "image.setAsset" } } }
              } as never
            },
            functions: {
              "fn-1": { graph: { nodes: { n2: { id: "n2", type: "custom.unknown" } } } } as never
            }
          }
        }
      },
      "bp-orphan": {
        id: "bp-orphan",
        name: "Orphan",
        owner: {} as never,
        frontend: "graph",
        programKind: "graph",
        members: { variables: { ov: { id: "ov", name: "Unreachable" } as never }, fields: {} },
        program: { kind: "graph", graphs: { events: {}, functions: {} } }
      }
    }
  } as unknown as BlueprintDocument;
}

const labels = { unnamedEvent: "Unnamed event", unnamedFunction: "Unnamed function" };
const resolveNodeLabel = (type: string) => {
  if (type === "flow.branch") return "Branch";
  if (type === "image.setAsset") return "Set Image Asset";
  return undefined;
};

function extractRaw(
  resolveOwnerLabel?: (ownerKey: string) => string | undefined
): SearchIndexEntry[] {
  return extractBlueprintEntries(blueprintDoc(), {
    resolveNodeLabel,
    resolveOwnerLabel,
    registryVariables: [
      {
        id: "pv1",
        name: "Total Playtime",
        valueType: "json",
        storageKey: "pv1",
        scope: "persistent"
      },
      { id: "sv1", name: "Chapter Reached", valueType: "number", storageKey: "sv1", scope: "saved" }
    ],
    labels
  });
}

/**
 * What the index actually holds: the extractor's output run through the source's declared
 * `dedupKey`, exactly as `SearchIndexEngine` does it. The collapsing is the framework's now, so the
 * assertions about it are assertions about the composition.
 */
function extract(resolveOwnerLabel?: (ownerKey: string) => string | undefined): SearchIndexEntry[] {
  return dedupSearchEntries(extractRaw(resolveOwnerLabel), blueprintSource.dedupKey!);
}

const entries = extract((ownerKey) =>
  ownerKey === "surfaceMain:surf-1" ? "Main Menu › Portrait" : undefined
);

describe("extractBlueprintEntries", () => {
  it("indexes the blueprint itself, named by what it hangs on", () => {
    expect(
      entries.find((e) => e.group === "blueprint" && e.text === "Main Menu Logic")
    ).toMatchObject({
      text: "Main Menu Logic",
      detail: "Main Menu › Portrait",
      target: { kind: "blueprint", blueprintId: "bp-1", ownerKey: "surfaceMain:surf-1" }
    });
  });

  it("indexes member variables with the owner key for jumping", () => {
    const memberVar = entries.find((e) => e.text === "Menu Open");
    expect(memberVar).toMatchObject({
      group: "variable",
      detail: "Main Menu Logic › Main Menu › Portrait",
      target: { kind: "blueprint", blueprintId: "bp-1", ownerKey: "surfaceMain:surf-1" }
    });
  });

  it("indexes persistent variables against the global blueprint", () => {
    const persistent = entries.find((e) => e.text === "Total Playtime");
    expect(persistent).toMatchObject({
      target: { kind: "blueprint", blueprintId: "bp-global", ownerKey: "globalMain" }
    });
  });

  // A saved variable that lives only in the registry - which, after the declaration migration, is
  // every saved variable - used to be unreachable from search entirely while its persistent
  // sibling was indexed.
  it("indexes registry SAVED variables too, not just persistent ones", () => {
    const saved = entries.find((e) => e.text === "Chapter Reached");
    expect(saved).toMatchObject({
      group: "variable",
      target: { kind: "blueprint", blueprintId: "bp-global", ownerKey: "globalMain" }
    });
  });

  // The two scopes have separate entry id spaces, so the scope has to be in the id or one scope's
  // row could shadow the other's.
  it("keys a registry row by scope so the two id spaces cannot collide", () => {
    expect(entries.find((e) => e.text === "Total Playtime")?.id).toBe("bpvar:persistent:pv1");
    expect(entries.find((e) => e.text === "Chapter Reached")?.id).toBe("bpvar:saved:sv1");
  });

  it("resolves node labels through the catalog and falls back to the raw type", () => {
    const branch = entries.find((e) => e.group === "blueprintNode" && e.text === "Branch");
    expect(branch).toMatchObject({
      target: { kind: "blueprint", blueprintId: "bp-1", focusEventId: "ev-1", focusNodeId: "n1" }
    });
    const raw = entries.find((e) => e.group === "blueprintNode" && e.text === "custom.unknown");
    expect(raw).toMatchObject({
      target: { kind: "blueprint", focusFunctionId: "fn-1", focusNodeId: "n2" }
    });
  });

  it("says where a node lives: owner › graph, not just the blueprint's name", () => {
    expect(entries.find((e) => e.group === "blueprintNode" && e.text === "Branch")?.detail).toBe(
      "Main Menu › Portrait › On Click"
    );
  });

  it("falls back to the blueprint name when the owner cannot be named", () => {
    const anonymous = extract();
    expect(anonymous.find((e) => e.group === "blueprintNode" && e.text === "Branch")?.detail).toBe(
      "Main Menu Logic › On Click"
    );
  });

  // The reported failure: eight identical "Set Image Asset · Blueprint Nodes" rows.
  it("collapses indistinguishable nodes into one row carrying the count", () => {
    const setters = entries.filter(
      (e) => e.group === "blueprintNode" && e.text === "Set Image Asset"
    );
    expect(setters).toHaveLength(2);
    const collapsed = setters.find((e) => e.detail === "Main Menu › Portrait › On Click");
    // s1 + s2 in "On Click", plus s4 in the identically-named sibling layer.
    expect(collapsed?.count).toBe(3);
    expect(collapsed?.target).toMatchObject({ focusNodeId: "s1" });
  });

  it("never emits two rows a person could not tell apart", () => {
    const shown = entries
      .filter((e) => e.group === "blueprintNode")
      .map((e) => `${e.text}|${e.detail}`);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("keeps a node whose own literals tell it apart, and shows them", () => {
    const distinct = entries.find(
      (e) => e.group === "blueprintNode" && e.detail?.startsWith("forest at dusk")
    );
    expect(distinct).toMatchObject({
      text: "Set Image Asset",
      detail: "forest at dusk · Main Menu › Portrait › On Click",
      // Remaining literals stay searchable without crowding the row.
      aux: "second pass"
    });
    // It stands for itself alone, so no count badge.
    expect(distinct?.count).toBeUndefined();
  });

  it("ignores ids, numbers and booleans when looking for a distinguishing literal", () => {
    const distinct = entries.find(
      (e) => e.group === "blueprintNode" && e.detail?.startsWith("forest at dusk")
    );
    expect(distinct?.aux).not.toContain("6f1c9a2e");
    expect(distinct?.aux).not.toContain("true");
  });

  it("names an unnamed graph rather than showing its id", () => {
    expect(entries.find((e) => e.text === "custom.unknown")?.detail).toBe(
      "Main Menu › Portrait › Unnamed function"
    );
  });

  it("skips blueprints without an owner record", () => {
    expect(entries.find((e) => e.text === "Unreachable")).toBeUndefined();
    expect(entries.find((e) => e.text === "Orphan")).toBeUndefined();
  });

  it("appends node rows after every blueprint and variable row", () => {
    const firstNode = entries.findIndex((e) => e.group === "blueprintNode");
    const lastNonNode = entries.map((e) => e.group !== "blueprintNode").lastIndexOf(true);
    expect(firstNode).toBeGreaterThan(lastNonNode);
  });
});

describe("blueprintSource.dedupKey", () => {
  it("collapses only node rows, and only the ones whose title and context line both match", () => {
    const raw = extractRaw((ownerKey) =>
      ownerKey === "surfaceMain:surf-1" ? "Main Menu › Portrait" : undefined
    );
    // One entry per node before the pass: s1, s2, s3, s4 are four separate nodes.
    expect(
      raw.filter((e) => e.group === "blueprintNode" && e.text === "Set Image Asset")
    ).toHaveLength(4);
    expect(raw.every((e) => e.count === undefined)).toBe(true);
  });

  it("never collapses a blueprint or a variable, however alike they look", () => {
    const twins: SearchIndexEntry[] = [
      {
        id: "bp:a",
        group: "blueprint",
        text: "Image",
        detail: "Main Menu",
        target: { kind: "blueprint", blueprintId: "a", ownerKey: "surfaceMain:s" }
      },
      {
        id: "bp:b",
        group: "blueprint",
        text: "Image",
        detail: "Main Menu",
        target: { kind: "blueprint", blueprintId: "b", ownerKey: "surfaceMain:s" }
      }
    ];
    expect(dedupSearchEntries(twins, blueprintSource.dedupKey!)).toHaveLength(2);
  });
});
