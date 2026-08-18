import { describe, expect, it } from "vitest";
import { ReferenceService } from "./ReferenceService";
import { Services, type WorkspaceContext } from "../services";

/**
 * `ReferenceService.getIndexResult()` — the answer everything that deletes on this index's word has
 * to consult first.
 *
 * The failure this is about is silent by construction: a slice that throws is caught, logged to the
 * console nobody is reading, and contributes an empty list that is indistinguishable from a project
 * where nothing uses anything. These cases drive the real `buildAll` with one dependency broken at
 * a time, because the point is that the *service* notices, not that the model can hold a gap.
 */

type MountOptions = {
  stories?: Array<{ id: string; name: string }>;
  storyLoadFails?: string;
  /** Break the incremental rescan (`onDocumentChanged`), not the initial build. */
  storyRescanFails?: boolean;
  blueprintFails?: boolean;
  blueprintNodes?: Record<string, unknown>;
  /** Node types the catalogue admits to knowing; everything else reads as unknown. */
  knownNodeTypes?: readonly string[];
  charactersFail?: boolean;
};

const noop = () => () => {};

function mount(options: MountOptions = {}): ReferenceService {
  const stories = options.stories ?? [];
  const ctx = {
    services: {
      get: (id: Services) => {
        switch (id) {
          case Services.Story:
            return {
              loadLibrary: async () => undefined,
              listStories: () => stories,
              loadStory: async (storyId: string) => {
                if (storyId === options.storyLoadFails) {
                  throw new Error("story will not parse");
                }
                return { id: storyId, scenes: {} };
              },
              getStoryDocument: (storyId: string) => {
                if (options.storyRescanFails) {
                  throw new Error("story will not parse");
                }
                return { id: storyId, scenes: {} };
              },
              listAnimationAssets: () => [],
              loadAnimationAsset: async () => ({ id: "a", name: "a", sequences: [] }),
              onDocumentChanged: noop,
              onLibraryChanged: noop,
              onAnimationsChanged: noop
            };
          case Services.Voice:
            return {
              getConfiguration: () => ({ voicedLocales: [] }),
              loadDocument: async () => ({ locale: "en", units: {} }),
              onDocumentChanged: noop
            };
          case Services.LocalBlueprint:
            return {
              getBlueprintDocument: () => {
                if (options.blueprintFails) {
                  throw new Error("blueprint document will not load");
                }
                if (!options.blueprintNodes) {
                  return { ownerRecords: {}, blueprints: {} };
                }
                return {
                  ownerRecords: {
                    globalMain: { activeBlueprintId: "bp-1", privateBlueprintIds: [] }
                  },
                  blueprints: {
                    "bp-1": {
                      id: "bp-1",
                      name: "Main",
                      program: {
                        kind: "graph",
                        graphs: {
                          events: { "g-1": { graph: { nodes: options.blueprintNodes } } },
                          functions: {}
                        }
                      }
                    }
                  }
                };
              }
            };
          case Services.BlueprintNodeCatalog:
            return {
              get: (type: string) =>
                options.knownNodeTypes?.includes(type) ? { type } : undefined,
              resolveCatalogEntry: (type: string) => ({ displayName: type, pins: [] })
            };
          case Services.UIDocument:
            return { getDocument: () => ({ elements: {} }), onDocumentChanged: noop };
          case Services.UIGraph:
            return { onGraphsChanged: noop };
          case Services.Character:
            return {
              listCharacter: () => {
                if (options.charactersFail) {
                  throw new Error("character store is unreadable");
                }
                return [];
              },
              subscribe: noop
            };
          default:
            throw new Error(`Unexpected service lookup: ${String(id)}`);
        }
      }
    }
  } as unknown as WorkspaceContext;

  const service = new ReferenceService();
  service.setContext(ctx);
  return service;
}

describe("ReferenceService.getIndexResult", () => {
  it("reports an index that has never been built as incomplete, not as empty", async () => {
    // Every asset in the project is unreferenced to an index that has read nothing, so this is
    // the state in which "delete the unused ones" would delete the project.
    const service = mount();

    expect(service.getIndexResult()).toEqual({
      complete: false,
      gaps: [{ reason: "indexNotBuilt" }]
    });
  });

  it("is complete once every slice has been read", async () => {
    const service = mount({ stories: [{ id: "s1", name: "Main Story" }] });

    await service.ensureReady();

    expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
  });

  it("names the slice that threw", async () => {
    const service = mount({ blueprintFails: true });

    await service.ensureReady();
    const result = service.getIndexResult();

    expect(result.complete).toBe(false);
    expect(result.gaps).toEqual([
      { reason: "sliceFailed", slice: "blueprint", location: "Blueprints" }
    ]);
  });

  it("names the document that would not load, by the name the author gave it", async () => {
    const service = mount({ stories: [{ id: "s1", name: "Main Story" }], storyLoadFails: "s1" });

    await service.ensureReady();
    const result = service.getIndexResult();

    expect(result.complete).toBe(false);
    expect(result.gaps).toEqual([
      { reason: "documentUnreadable", slice: "story", location: "Main Story" }
    ]);
  });

  it("collects a gap from each slice that failed", async () => {
    const service = mount({ blueprintFails: true, charactersFail: true });

    await service.ensureReady();

    expect(
      service
        .getIndexResult()
        .gaps.map((gap) => gap.slice)
        .sort()
    ).toEqual(["blueprint", "character"]);
  });

  it("drops a gap once the slice reads cleanly again", async () => {
    // A gap that outlived its cause would leave the index permanently incomplete, and the
    // delete guard permanently refusing.
    const service = mount({ stories: [{ id: "s1", name: "Main Story" }], storyLoadFails: "s1" });
    await service.ensureReady();
    expect(service.getIndexResult().complete).toBe(false);

    const healed = mount({ stories: [{ id: "s1", name: "Main Story" }] });
    await healed.ensureReady();

    expect(healed.getIndexResult().complete).toBe(true);
  });
});

describe("the incremental story rescan", () => {
  /** The path `onDocumentChanged` runs, which is the one that runs on every scene edit. */
  const rescan = (service: ReferenceService, storyId: string) =>
    (service as unknown as { rebuildStorySlice(id: string): void }).rebuildStorySlice(storyId);

  it("keeps the gap when a story that is still in the library will not read", async () => {
    // The build path reports this correctly; the rescan path used to clear the gap it should
    // raise, so a project that opened clean went back to reporting full coverage the moment an
    // edit made a document unreadable - with that story's references already dropped.
    const service = mount({ stories: [{ id: "s1", name: "Main Story" }], storyRescanFails: true });
    await service.ensureReady();
    expect(service.getIndexResult().complete).toBe(true);

    rescan(service, "s1");

    expect(service.getIndexResult()).toEqual({
      complete: false,
      gaps: [{ reason: "documentUnreadable", slice: "story", location: "Main Story" }]
    });
  });

  it("reports nothing for a story that has been deleted", async () => {
    // The other failure that arrives at the same catch. A story that is gone contributes no
    // references and no doubt, and a gap here would never clear.
    const service = mount({ stories: [], storyRescanFails: true });
    await service.ensureReady();

    rescan(service, "deleted-story");

    expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
  });
});

describe("nodes the catalogue does not know", () => {
  it("reports a gap rather than reading silence as coverage", async () => {
    // `resolveCatalogEntry` answers for an unknown type with a two-exec-pin stub, so it can
    // never throw and never says "unknown". Asking it alone reported an uninstalled plugin's
    // nodes as holding no assets at all.
    const service = mount({
      blueprintNodes: { n1: { id: "n1", type: "acme.showBanner", params: { banner: "img-1" } } },
      knownNodeTypes: []
    });

    await service.ensureReady();
    const result = service.getIndexResult();

    expect(result.complete).toBe(false);
    expect(result.gaps).toEqual([
      expect.objectContaining({ reason: "unknownNodeType", slice: "blueprint" })
    ]);
  });

  it("says nothing about a node type the catalogue has", async () => {
    const service = mount({
      blueprintNodes: { n1: { id: "n1", type: "blueprint.flow.branch", params: {} } },
      knownNodeTypes: ["blueprint.flow.branch"]
    });

    await service.ensureReady();

    expect(service.getIndexResult()).toEqual({ complete: true, gaps: [] });
  });
});
