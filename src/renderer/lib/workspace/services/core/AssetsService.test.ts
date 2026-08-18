import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetsService } from "./AssetsService";
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { AssetCategory, AssetType } from "../assets/assetTypes";
import {
  AssetSource,
  type Asset,
  type AssetGroup,
  type AssetGroupMap,
  type AssetsMap
} from "../assets/types";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import type { ReferenceIndexResult } from "../references/referenceModel";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A filesystem just real enough for the undo trash: files are keys, directories are prefixes.
 *
 * Deleting an asset now *moves* its payload rather than unlinking it, so "did the bytes survive"
 * is a question these tests have to be able to ask.
 */
const fakeDisk = new Map<string, string>();
const ok = <T>(data: T) => ({ success: true as const, data: { ok: true as const, data } });

vi.mock("@/lib/app/privilegedFacade", () => ({
  appPrivilegedFacade: {
    fs: {
      isFileExists: async (path: string) => ok(fakeDisk.has(path)),
      isDirExists: async (path: string) =>
        ok([...fakeDisk.keys()].some((key) => key.startsWith(path))),
      createDir: async () => ok(undefined),
      deleteFile: async (path: string) => {
        fakeDisk.delete(path);
        return ok(undefined);
      },
      deleteDir: async (path: string) => {
        [...fakeDisk.keys()]
          .filter((key) => key.startsWith(path))
          .forEach((key) => fakeDisk.delete(key));
        return ok(undefined);
      },
      moveFile: async (src: string, dest: string) => {
        const value = fakeDisk.get(src);
        if (value === undefined) return { success: true as const, data: { ok: false as const } };
        fakeDisk.delete(src);
        fakeDisk.set(dest, value);
        return ok(undefined);
      },
      moveDir: async (src: string, dest: string) => {
        for (const key of [...fakeDisk.keys()].filter((k) => k.startsWith(src))) {
          fakeDisk.set(dest + key.slice(src.length), fakeDisk.get(key)!);
          fakeDisk.delete(key);
        }
        return ok(undefined);
      }
    }
  }
}));

/**
 * The asset write path had no coverage at all before this file, which is how the two defects this
 * suite pins could exist: a replacement that never moved the hash or dropped the thumbnail, and a
 * delete guard that lived in a React hook and so was skipped by every other caller.
 *
 * These are seam tests, not filesystem tests — the bytes are somebody else's problem. What is
 * asserted here is the order the service does things in, and that nothing can reach a delete without
 * passing the reference check first.
 */

function emptyAssetsMap(): AssetsMap {
  return {
    [AssetType.Image]: {},
    [AssetType.Audio]: {},
    [AssetType.Video]: {},
    [AssetType.JSON]: {},
    [AssetType.Blueprint]: {},
    [AssetType.Font]: {},
    [AssetType.Model]: {},
    [AssetType.Other]: {}
  };
}

function emptyGroupMap(): AssetGroupMap {
  return {
    [AssetCategory.Image]: {},
    [AssetCategory.Media]: {},
    [AssetCategory.Data]: {},
    [AssetCategory.Font]: {},
    [AssetCategory.Model]: {},
    [AssetCategory.Other]: {}
  };
}

function imageGroup(id: string, parentGroupId?: string): AssetGroup {
  return { id, name: id, category: AssetCategory.Image, parentGroupId, createdAt: 0, updatedAt: 0 };
}

/** A row of a type no picture-shaped gap can be hiding, for the scoping cases. */
function audioAsset(id: string): Asset<AssetType.Audio, AssetSource.Local> {
  return {
    id,
    type: AssetType.Audio,
    name: `${id}.mp3`,
    hash: `hash-${id}`,
    ext: "mp3",
    source: AssetSource.Local,
    meta: {},
    tags: [],
    description: ""
  } as unknown as Asset<AssetType.Audio, AssetSource.Local>;
}

function imageAsset(
  id: string,
  overrides: Partial<Asset<AssetType.Image, AssetSource.Local>> = {}
): Asset<AssetType.Image, AssetSource.Local> {
  return {
    id,
    type: AssetType.Image,
    name: `${id}.png`,
    hash: `hash-${id}`,
    ext: "png",
    source: AssetSource.Local,
    meta: {},
    tags: [],
    description: "",
    ...overrides
  };
}

interface HarnessOptions {
  /** `assetId → reference labels`. Anything listed here counts as "still in use". */
  references?: Record<string, string[]>;
  /** Simulate a reference index that cannot answer (unbuilt, or the service is missing). */
  referenceLookup?: "ok" | "throws" | "missing";
  /** Simulate an index that answered but does not cover the whole project. */
  assetIndex?: ReferenceIndexResult;
  groups?: AssetGroup[];
}

function createHarness(
  assets: Asset<AssetType, AssetSource.Local>[],
  options: HarnessOptions = {}
) {
  const calls: string[] = [];
  const metadata = emptyAssetsMap();
  for (const asset of assets) {
    // Filed under its own type, so a case about one asset kind is not silently a case about
    // another - which is what the coverage-scoping cases below turn on.
    (metadata[asset.type] as Record<string, unknown>)[asset.id] = asset;
  }
  const groupMap = emptyGroupMap();
  for (const group of options.groups ?? []) {
    groupMap[AssetCategory.Image][group.id] = group;
  }

  const referenceService = {
    async ensureReady() {
      if (options.referenceLookup === "throws") {
        throw new Error("index build failed");
      }
    },
    async flushPendingRebuilds() {},
    getReferencesForAll(ids: readonly string[]) {
      const result = new Map<string, unknown[]>();
      for (const id of ids) {
        const labels = options.references?.[id];
        if (labels?.length) {
          result.set(
            id,
            labels.map((label) => ({ id: `${id}:${label}`, kind: "story", label }))
          );
        }
      }
      return result;
    },
    // The guard reads coverage as well as references. Complete unless a case says otherwise:
    // an incomplete index refuses every delete, which is a different test.
    getIndexResult() {
      return options.assetIndex ?? { complete: true, gaps: [] };
    }
  };

  const historyService = new HistoryService();
  const context = {
    // Mirrors Porject.resolve, which flattens the convention arrays and joins every segment.
    // A stub that returned only the first argument collapsed every trash slot onto one path,
    // so two files deleted together overwrote each other.
    project: {
      resolve: (...parts: (string | string[])[]) =>
        parts
          .flatMap((part) => (Array.isArray(part) ? part : [part]))
          .join("/")
          .replace(/\/+/g, "/")
    },
    services: {
      get(serviceId: Services) {
        if (serviceId === Services.FileSystem) {
          return {
            writeFileNoFollow: async () => ({ ok: true, data: undefined }),
            write: async () => ({ ok: true, data: undefined })
          };
        }
        if (serviceId === Services.Reference) {
          if (options.referenceLookup === "missing") {
            throw new Error("Reference service is not registered");
          }
          return referenceService;
        }
        if (serviceId === Services.History) {
          // Deleting an asset records an undo step; the guard tests only care that the
          // delete happened, so a real stack with nothing reading it is enough.
          return historyService;
        }
        throw new Error(`Unexpected service ${serviceId}`);
      }
    }
  };

  const service = new AssetsService();
  historyService.setContext(context as any);
  service.setContext(context as any);

  const metadataManager = new AssetsMetadataManager(service, context as any);
  metadataManager.assetsMetadata = metadata;

  const localAssetsManager = {
    async writeAssetContentFromPath(_asset: Asset, sourcePath: string) {
      calls.push("write-bytes");
      return {
        success: true as const,
        data: {
          hash: `hash-of:${sourcePath}`,
          ext: sourcePath.split(".").pop()?.toLowerCase()
        }
      };
    },
    getLocalAssetPath(assetId: string) {
      return `assets/content/${assetId}`;
    },
    async deleteAsset(asset: Asset, deleteOptions?: { keepPayload?: boolean }) {
      calls.push(`delete-asset:${asset.id}`);
      if (!deleteOptions?.keepPayload) {
        fakeDisk.delete(`assets/content/${asset.id}`);
      }
      delete metadata[asset.type][asset.id];
      service.getEvents().emit("deleted", asset);
      return { success: true as const, data: undefined };
    }
  };

  // The real group manager, because the cascade is the thing being tested: it deletes contained
  // assets one at a time through `AssetsService.deleteAsset`, which is where the guard now sits.
  const groupAssetsManager = new GroupAssetsManager(service, context as any);
  groupAssetsManager.assetsGroups = groupMap;

  (service as any).assetsMetadataManager = metadataManager;
  (service as any).localAssetsManager = localAssetsManager;
  (service as any).groupAssetsManager = groupAssetsManager;

  vi.spyOn(service, "clearThumbnailCache").mockImplementation(async (assetId?: string) => {
    calls.push(`clear-thumbnail:${assetId}`);
  });

  service.getEvents().on("updated", (asset) => calls.push(`updated:${asset.id}`));

  return { service, metadata, groupMap, calls, history: historyService };
}

/** Put an asset's bytes on the fake disk where the trash expects to find them. */
function seedPayload(assetId: string, bytes = `bytes-of-${assetId}`) {
  fakeDisk.set(`assets/content/${assetId}`, bytes);
}

describe("AssetsService.replaceAssetContent", () => {
  it("moves the hash, drops the thumbnail before announcing, and keeps the id", async () => {
    const asset = imageAsset("asset-1");
    const { service, metadata, calls } = createHarness([asset]);

    const result = await service.replaceAssetContent(asset, "C:/incoming/new-room.png");

    expect(result.success).toBe(true);
    // The id is the whole point of replacing: every reference stores it, so nothing relinks.
    expect(result.success && result.data?.id).toBe("asset-1");
    expect(metadata[AssetType.Image]["asset-1"].hash).toBe("hash-of:C:/incoming/new-room.png");
    expect(metadata[AssetType.Image]["asset-1"].hash).not.toBe("hash-asset-1");

    // Order matters: a subscriber woken before the thumbnail PNG is gone re-reads the old one.
    expect(calls).toEqual(["write-bytes", "clear-thumbnail:asset-1", "updated:asset-1"]);
  });

  it("follows the new file's extension and keeps the display name unique", async () => {
    const asset = imageAsset("asset-1", { name: "room.png" });
    const sibling = imageAsset("asset-2", { name: "room.jpg", ext: "jpg" });
    const { service, metadata } = createHarness([asset, sibling]);

    await service.replaceAssetContent(asset, "C:/incoming/room.JPG");

    expect(metadata[AssetType.Image]["asset-1"].ext).toBe("jpg");
    expect(metadata[AssetType.Image]["asset-1"].name).toBe("room-1.jpg");
    expect(metadata[AssetType.Image]["asset-2"].name).toBe("room.jpg");
  });

  it("refuses remote assets, which have no local file to overwrite", async () => {
    const asset = imageAsset("asset-1");
    const { service, calls } = createHarness([asset]);

    const remote = { ...asset, source: AssetSource.Remote } as unknown as Asset<AssetType.Image>;
    const result = await service.replaceAssetContent(remote, "C:/incoming/new-room.png");

    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("AssetsService delete guard", () => {
  it("refuses to delete a referenced asset", async () => {
    const asset = imageAsset("asset-1", { name: "room.jpg" });
    const { service, metadata, calls } = createHarness([asset], {
      references: { "asset-1": ["First Day"] }
    });

    const result = await service.deleteAsset(asset);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("room.jpg");
    expect(calls).toEqual([]);
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
  });

  it("lets an author who has been shown the references through", async () => {
    const asset = imageAsset("asset-1");
    const { service, metadata, calls } = createHarness([asset], {
      references: { "asset-1": ["First Day"] }
    });

    const result = await service.deleteAsset(asset, { allowReferenced: true });

    expect(result.success).toBe(true);
    expect(calls).toEqual(["delete-asset:asset-1", "clear-thumbnail:asset-1"]);
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
  });

  it("deletes an unreferenced asset without asking anyone", async () => {
    const asset = imageAsset("asset-1");
    const { service, metadata } = createHarness([asset]);

    const result = await service.deleteAsset(asset);

    expect(result.success).toBe(true);
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
  });

  it("refuses when the reference index cannot answer, rather than reading silence as consent", async () => {
    const asset = imageAsset("asset-1");
    const { service, metadata } = createHarness([asset], { referenceLookup: "throws" });

    const result = await service.deleteAsset(asset);

    expect(result.success).toBe(false);
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();

    const missing = createHarness([imageAsset("asset-2")], { referenceLookup: "missing" });
    expect((await missing.service.deleteAsset(imageAsset("asset-2"))).success).toBe(false);
  });

  it("refuses when the index answered but does not cover the whole project", async () => {
    // The index has no reference to this asset, and would have deleted it a moment ago. What
    // stops it is that somewhere in the project a picture is in use under a name the index
    // could not read, and this asset is a candidate for being that picture.
    const asset = imageAsset("asset-1");
    const { service, metadata } = createHarness([asset], {
      assetIndex: {
        complete: false,
        gaps: [
          { reason: "hashUrlUnresolved", slice: "ui", location: "Title Screen.backgroundImage" }
        ]
      }
    });

    const result = await service.deleteAsset(asset);

    expect(result.success).toBe(false);
    // The refusal names where coverage stopped, so the author has somewhere to go.
    expect(result.error).toContain("Title Screen.backgroundImage");
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
  });

  it("lets an unrelated asset through a gap that can only be hiding a picture", async () => {
    // The other end of the same rule. A widget with an unreadable picture says nothing about
    // whether a sound is used, and holding it against every asset would leave one pasted URL
    // able to put the whole library beyond deleting for the rest of the project's life.
    const sound = audioAsset("asset-1");
    const { service, metadata } = createHarness([sound], {
      assetIndex: {
        complete: false,
        gaps: [
          {
            reason: "hashUrlUnresolved",
            slice: "ui",
            location: "Title Screen.backgroundImage",
            affects: ["image"]
          }
        ]
      }
    });

    const result = await service.deleteAsset(sound);

    expect(result.success).toBe(true);
    expect(metadata[AssetType.Audio]["asset-1"]).toBeUndefined();
  });

  it("holds a gap that names no kinds against every asset", async () => {
    // An unread story can hold a use of anything, so it narrows nothing.
    const sound = audioAsset("asset-1");
    const { service, metadata } = createHarness([sound], {
      assetIndex: {
        complete: false,
        gaps: [{ reason: "documentUnreadable", slice: "story", location: "Main Story" }]
      }
    });

    expect((await service.deleteAsset(sound)).success).toBe(false);
    expect(metadata[AssetType.Audio]["asset-1"]).toBeDefined();
  });

  it("still deletes on the author's say-so when the index is incomplete", async () => {
    // The guard warns and defers; it does not take the decision away. A caller that has shown
    // the author what it knows may go ahead, exactly as it may over a live reference.
    const asset = imageAsset("asset-1");
    const { service, metadata } = createHarness([asset], {
      assetIndex: { complete: false, gaps: [{ reason: "indexNotBuilt" }] }
    });

    const result = await service.deleteAsset(asset, { allowReferenced: true });

    expect(result.success).toBe(true);
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
  });

  /**
   * The bypass this closes: deleting a *group* used to walk its contents straight
   * into `deleteAsset` without ever consulting the index, because the check lived in the panel's
   * hook. A folder of referenced backgrounds went quietly.
   */
  it("blocks a group cascade whose contents are still referenced, before deleting anything", async () => {
    const kept = imageAsset("asset-1", { name: "room.jpg", groupId: "group-a" });
    const alsoKept = imageAsset("asset-2", { name: "hall.jpg", groupId: "group-a" });
    const { service, metadata, groupMap, calls } = createHarness([kept, alsoKept], {
      groups: [imageGroup("group-a")],
      references: { "asset-2": ["First Day"] }
    });

    const result = await service.deleteGroup(AssetCategory.Image, "group-a", true);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain("hall.jpg");
    // Nothing was removed — not even the unreferenced sibling that happened to be enumerated first.
    expect(calls).toEqual([]);
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
    expect(metadata[AssetType.Image]["asset-2"]).toBeDefined();
    expect(groupMap[AssetCategory.Image]["group-a"]).toBeDefined();
  });

  it("sees references inside nested groups the cascade would reach", async () => {
    const nested = imageAsset("asset-1", { name: "sky.jpg", groupId: "group-b" });
    const { service, metadata } = createHarness([nested], {
      groups: [imageGroup("group-a"), imageGroup("group-b", "group-a")],
      references: { "asset-1": ["Prologue"] }
    });

    const result = await service.deleteGroup(AssetCategory.Image, "group-a", true);

    expect(result.success).toBe(false);
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
  });

  it("deletes the whole group once the author has confirmed", async () => {
    const first = imageAsset("asset-1", { groupId: "group-a" });
    const nested = imageAsset("asset-2", { groupId: "group-b" });
    const { service, metadata, groupMap } = createHarness([first, nested], {
      groups: [imageGroup("group-a"), imageGroup("group-b", "group-a")],
      references: { "asset-2": ["Prologue"] }
    });

    const result = await service.deleteGroup(AssetCategory.Image, "group-a", true, {
      allowReferenced: true
    });

    expect(result.success).toBe(true);
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    expect(metadata[AssetType.Image]["asset-2"]).toBeUndefined();
    expect(groupMap[AssetCategory.Image]["group-a"]).toBeUndefined();
    expect(groupMap[AssetCategory.Image]["group-b"]).toBeUndefined();
  });
});

describe("AssetsService deletion undo", () => {
  beforeEach(() => {
    fakeDisk.clear();
  });

  it("brings back the record and the bytes", async () => {
    const asset = imageAsset("asset-1");
    seedPayload("asset-1");
    const { service, metadata, history } = createHarness([asset]);

    await service.deleteAsset(asset, { allowReferenced: true });
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    // Moved, not unlinked - that is the whole point of the trash.
    expect(fakeDisk.get("assets/content/asset-1")).toBeUndefined();
    expect([...fakeDisk.values()]).toContain("bytes-of-asset-1");

    expect(history.undo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(metadata[AssetType.Image]["asset-1"]?.name).toBe("asset-1.png");
    expect(fakeDisk.get("assets/content/asset-1")).toBe("bytes-of-asset-1");
  });

  it("restores the record verbatim, so the asset returns to the folder it was in", async () => {
    const asset = imageAsset("asset-1", { groupId: "group-a" });
    seedPayload("asset-1");
    const { service, metadata, history } = createHarness([asset], {
      groups: [imageGroup("group-a")]
    });

    await service.deleteAsset(asset, { allowReferenced: true });
    history.undo(projectHistoryScope());
    await history.settled();

    expect(metadata[AssetType.Image]["asset-1"]?.groupId).toBe("group-a");
  });

  it("takes a whole folder back in one step, not one per file", async () => {
    const a = imageAsset("asset-1", { groupId: "group-a" });
    const b = imageAsset("asset-2", { groupId: "group-a" });
    seedPayload("asset-1");
    seedPayload("asset-2");
    const { service, metadata, groupMap, history } = createHarness([a, b], {
      groups: [imageGroup("group-a")]
    });

    await service.deleteGroup(AssetCategory.Image, "group-a", true, { allowReferenced: true });
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    expect(metadata[AssetType.Image]["asset-2"]).toBeUndefined();
    expect(groupMap[AssetCategory.Image]["group-a"]).toBeUndefined();

    // One press, not three: the cascade is one thing the author did.
    expect(history.undo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(history.canUndo(projectHistoryScope())).toBe(false);

    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
    expect(metadata[AssetType.Image]["asset-2"]).toBeDefined();
    expect(groupMap[AssetCategory.Image]["group-a"]?.name).toBe("group-a");
    expect(fakeDisk.get("assets/content/asset-1")).toBe("bytes-of-asset-1");
    expect(fakeDisk.get("assets/content/asset-2")).toBe("bytes-of-asset-2");
  });

  it("restores a nested folder tree from the inside out", async () => {
    const inner = imageAsset("asset-1", { groupId: "group-child" });
    seedPayload("asset-1");
    const { service, metadata, groupMap, history } = createHarness([inner], {
      groups: [imageGroup("group-root"), imageGroup("group-child", "group-root")]
    });

    await service.deleteGroup(AssetCategory.Image, "group-root", true, { allowReferenced: true });
    expect(groupMap[AssetCategory.Image]["group-child"]).toBeUndefined();

    history.undo(projectHistoryScope());
    await history.settled();
    expect(groupMap[AssetCategory.Image]["group-root"]).toBeDefined();
    expect(groupMap[AssetCategory.Image]["group-child"]?.parentGroupId).toBe("group-root");
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
  });

  it("lets the bytes go once the entry can never run again", async () => {
    const asset = imageAsset("asset-1");
    seedPayload("asset-1");
    const { service, history } = createHarness([asset]);

    await service.deleteAsset(asset, { allowReferenced: true });
    expect([...fakeDisk.values()]).toContain("bytes-of-asset-1");

    // A reload from disk throws every stack away; nothing can reach the payload after that.
    history.clearAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([...fakeDisk.values()]).not.toContain("bytes-of-asset-1");
  });

  it("redoes a deletion, setting the bytes aside again", async () => {
    const asset = imageAsset("asset-1");
    seedPayload("asset-1");
    const { service, metadata, history } = createHarness([asset]);

    await service.deleteAsset(asset, { allowReferenced: true });
    history.undo(projectHistoryScope());
    await history.settled();
    expect(fakeDisk.get("assets/content/asset-1")).toBe("bytes-of-asset-1");

    expect(history.redo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    // Still recoverable after a redo - not unlinked.
    expect([...fakeDisk.values()]).toContain("bytes-of-asset-1");
  });

  it("still deletes when the payload was already missing", async () => {
    const asset = imageAsset("asset-1");
    const { service, metadata, history } = createHarness([asset]);

    const result = await service.deleteAsset(asset, { allowReferenced: true });
    expect(result.success).toBe(true);
    expect(metadata[AssetType.Image]["asset-1"]).toBeUndefined();
    // The record still comes back; there were simply no bytes to bring with it.
    expect(history.undo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(metadata[AssetType.Image]["asset-1"]).toBeDefined();
  });
});
