import { describe, expect, it } from "vitest";
import { AssetOrderManager } from "./AssetOrderManager";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { GroupAssetsManager } from "./GroupAssetsManager";
import { AssetsService } from "../../core/AssetsService";
import { AssetCategory, AssetType } from "../assetTypes";
import { Services } from "../../services";

/**
 * Folding the per-type folder and row-order shards up into per-category ones, on the open that
 * finds the category shard missing.
 *
 * This is the one migration in the asset library that can destroy an author's work rather than
 * merely look wrong: a project whose folders live in `assets.groups.audio.json` and whose new
 * `assets.groups.media.json` is written as `{}` opens with every audio asset un-filed, its `groupId`
 * pointing at a group nothing holds any more. So the assertions here are about the three things the
 * merge must not get wrong — ids unchanged, old files untouched, same-named folders not collapsed —
 * and not about the shape of the new file.
 *
 * Seam tests, like `assetOrderMigration.test.ts`: the filesystem is a stub that hands back file text
 * and records what was written.
 */

const AUDIO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIDEO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const AUDIO_GROUPS = "assets.groups.audio.json";
const VIDEO_GROUPS = "assets.groups.video.json";
const MEDIA_GROUPS = "assets.groups.media.json";
const AUDIO_ORDER = "assets.order.audio.json";
const VIDEO_ORDER = "assets.order.video.json";
const MEDIA_ORDER = "assets.order.media.json";
const AUDIO_METADATA = "assets.metadata.audio.json";
const VIDEO_METADATA = "assets.metadata.video.json";

/** A group record in the shape the type-sharded builds wrote: `type`, no `category`. */
function legacyGroup(id: string, name: string, type: AssetType): string {
  return `{"id":"${id}","name":"${name}","type":"${type}","createdAt":0,"updatedAt":0}`;
}

function groupsShard(...records: string[]): string {
  return `{${records.map((record) => `${JSON.stringify(JSON.parse(record).id)}:${record}`).join(",")}}`;
}

function assetRecord(id: string, type: AssetType, groupId?: string): string {
  const group = groupId ? `,"groupId":"${groupId}"` : "";
  return `{"id":"${id}","type":"${type}","name":"${id}","hash":"h-${id}","ext":"bin","source":"local","meta":{},"tags":[],"description":""${group}}`;
}

function metadataShard(...records: string[]): string {
  return `{${records.map((record) => `${JSON.stringify(JSON.parse(record).id)}:${record}`).join(",")}}`;
}

/**
 * Every metadata shard, empty.
 *
 * Only needed by a harness that refuses writes: `AssetsMetadataManager` creates its shards with
 * `ensureRegularFile` and, when that is refused, falls down its own corrupted-shard recovery path.
 * That is a different question from this file's, and seeding the files keeps it out of the way.
 */
function emptyMetadataShards(): Record<string, string> {
  return Object.fromEntries(
    Object.values(AssetType).map((type) => [`assets.metadata.${type}.json`, "{}"])
  );
}

/**
 * `path suffix → file text`. Anything not listed reads back as absent.
 *
 * `refuseWrites` is the freeze latch, and it is the reason the merge cannot be built on a write:
 * `FileSystemService` answers a write refused by the freeze - or by a working tree being re-read
 * after a version restore - as a no-op success, so the file never appears and nothing in the result
 * says so. Modelled on the three verbs that carry the guard.
 */
function createHarness(
  files: Record<string, string> = {},
  options: { refuseWrites?: boolean } = {}
) {
  const writes: { path: string; data: string }[] = [];
  const present = { ...files };
  const refused = { ok: true as const, data: undefined };

  const suffixOf = (path: string): string | undefined =>
    Object.keys(present).find((candidate) => path.endsWith(candidate));

  const readText = (path: string): string | undefined => {
    const suffix = suffixOf(path);
    return suffix === undefined ? undefined : present[suffix];
  };

  const record = (path: string, data: string) => {
    writes.push({ path, data });
    present[suffixOf(path) ?? path.split("/").pop()!] = data;
    return { ok: true as const, data: undefined };
  };

  const filesystemService = {
    async ensureRegularFile(path: string, data: string) {
      if (options.refuseWrites) {
        return refused;
      }
      if (readText(path) === undefined) {
        return record(path, data);
      }
      return { ok: true as const, data: undefined };
    },
    async isFileExists(path: string) {
      return { ok: true as const, data: readText(path) !== undefined };
    },
    async read(path: string) {
      const text = readText(path);
      return text === undefined
        ? { ok: false as const, error: { code: "ENOENT", message: "missing" } }
        : { ok: true as const, data: text };
    },
    async readJSON(path: string) {
      const text = readText(path);
      if (text === undefined) {
        return { ok: false as const, error: { code: "ENOENT", message: "missing" } };
      }
      try {
        return { ok: true as const, data: JSON.parse(text) };
      } catch {
        return { ok: false as const, error: { code: "EINVAL", message: "bad json" } };
      }
    },
    async write(path: string, data: string) {
      if (options.refuseWrites) {
        return refused;
      }
      return record(path, data);
    },
    async writeFileNoFollow(path: string, data: string) {
      if (options.refuseWrites) {
        return refused;
      }
      if (readText(path) === undefined) {
        return { ok: false as const, error: { code: "ENOENT", message: `lstat '${path}'` } };
      }
      return record(path, data);
    },
    async recoverCorruptedJsonFile(path: string, replacement: string) {
      return record(path, replacement);
    }
  };

  const context = {
    project: { resolve: (segments: string[]) => segments.join("/") },
    services: {
      get(serviceId: Services) {
        if (serviceId === Services.FileSystem) {
          return filesystemService;
        }
        throw new Error(`Unexpected service ${serviceId}`);
      }
    }
  };

  const service = new AssetsService();
  service.setContext(context as any);

  return { service, context, writes, present };
}

/** The order `AssetsService.init` brings the three managers up in. */
async function initAssets(harness: ReturnType<typeof createHarness>) {
  const orderManager = await new AssetOrderManager(harness.context as any).init();
  (harness.service as any).assetOrderManager = orderManager;

  const metadataManager = new AssetsMetadataManager(harness.service, harness.context as any);
  (harness.service as any).assetsMetadataManager = metadataManager;
  (harness.service as any).assetsMetadataInitializing = true;
  try {
    await metadataManager.init();
  } finally {
    (harness.service as any).assetsMetadataInitializing = false;
  }
  await harness.service["flushPendingWrites"]();

  const groupManager = await new GroupAssetsManager(harness.service, harness.context as any).init();
  (harness.service as any).groupAssetsManager = groupManager;

  for (const category of orderManager.listMissingCategories()) {
    (harness.service as any).dirtyOrderCategories.add(category);
  }
  await harness.service["flushPendingWrites"]();

  return { metadataManager, groupManager, orderManager };
}

function lastWrite(writes: { path: string; data: string }[], suffix: string): string | undefined {
  return [...writes].reverse().find((write) => write.path.endsWith(suffix))?.data;
}

describe("folders, merging audio + video into media", () => {
  it("keeps every group, with its id unchanged, under the merged section", async () => {
    const harness = createHarness({
      [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video))
    });

    const { groupManager } = await initAssets(harness);

    const media = groupManager.getGroups(AssetCategory.Media);
    expect(media.map((group) => group.id)).toEqual(["group_a", "group_v"]);
    expect(media.map((group) => group.category)).toEqual([
      AssetCategory.Media,
      AssetCategory.Media
    ]);
  });

  it("leaves the assets in those groups filed, because their groupId never had to change", async () => {
    const harness = createHarness({
      [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video)),
      [AUDIO_METADATA]: metadataShard(assetRecord(AUDIO_A, AssetType.Audio, "group_a")),
      [VIDEO_METADATA]: metadataShard(assetRecord(VIDEO_B, AssetType.Video, "group_v"))
    });

    const { metadataManager } = await initAssets(harness);

    expect(metadataManager.getAssets()[AssetType.Audio][AUDIO_A].groupId).toBe("group_a");
    expect(metadataManager.getAssets()[AssetType.Video][VIDEO_B].groupId).toBe("group_v");
  });

  it("writes the merged shard and does not touch either file it read", async () => {
    const harness = createHarness({
      [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video))
    });

    await initAssets(harness);

    expect(Object.keys(JSON.parse(lastWrite(harness.writes, MEDIA_GROUPS)!))).toEqual([
      "group_a",
      "group_v"
    ]);
    // The old shards are still exactly what they were: read, never rewritten, never deleted.
    expect(harness.writes.some((write) => write.path.endsWith(AUDIO_GROUPS))).toBe(false);
    expect(harness.writes.some((write) => write.path.endsWith(VIDEO_GROUPS))).toBe(false);
    expect(harness.present[AUDIO_GROUPS]).toBe(
      groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio))
    );
    expect(harness.present[VIDEO_GROUPS]).toBe(
      groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video))
    );
  });

  it("keeps two same-named folders as two rows rather than de-duplicating them", async () => {
    // They were never one object: different ids, different assets. Collapsing them would move
    // one side's files into the other side's folder.
    const harness = createHarness({
      [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Chapter 1", AssetType.Video))
    });

    const { groupManager } = await initAssets(harness);

    const media = groupManager.getGroups(AssetCategory.Media);
    expect(media.map((group) => group.id)).toEqual(["group_a", "group_v"]);
    expect(media.map((group) => group.name)).toEqual(["Chapter 1", "Chapter 1"]);
  });

  it("does not run again once the merged shard exists", async () => {
    const harness = createHarness({
      [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video)),
      [MEDIA_GROUPS]: groupsShard(legacyGroup("group_kept", "Already merged", AssetType.Audio))
    });

    const { groupManager } = await initAssets(harness);

    expect(groupManager.getGroups(AssetCategory.Media).map((group) => group.id)).toEqual([
      "group_kept"
    ]);
    expect(harness.writes.some((write) => write.path.endsWith(MEDIA_GROUPS))).toBe(false);
  });

  it("leaves a category whose shard is simply absent with no folders, and creates the file", async () => {
    const harness = createHarness({});

    const { groupManager } = await initAssets(harness);

    expect(groupManager.getGroups(AssetCategory.Media)).toEqual([]);
    expect(JSON.parse(lastWrite(harness.writes, MEDIA_GROUPS)!)).toEqual({});
  });

  it("still reads the folders out of the legacy shards when the write that would create the merged file is refused", async () => {
    // The open a frozen workspace performs, and the one a version restore performs while it
    // re-reads the working tree. Creating the merged shard is an optimisation for the next open;
    // if it were a precondition for reading, every such open would come up with no folders at
    // all - or fail outright on the read-back of a file that was never written.
    const harness = createHarness(
      {
        ...emptyMetadataShards(),
        [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
        [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video))
      },
      { refuseWrites: true }
    );

    const { groupManager } = await initAssets(harness);

    expect(groupManager.getGroups(AssetCategory.Media).map((group) => group.id)).toEqual([
      "group_a",
      "group_v"
    ]);
    // The refusal really did keep the file off the disk, so the next open repeats the merge.
    expect(harness.present[MEDIA_GROUPS]).toBeUndefined();
  });

  it("refuses to migrate a legacy shard that is on disk and cannot be read, and writes nothing", async () => {
    // The other half of "absent contributes nothing": a shard that exists but does not parse
    // holds folders this merge cannot see. Treating it as empty would write a merged file
    // without them - and every open after that would read the merged file and never look at
    // the audio shard again, turning one bad read into a permanent loss.
    const harness = createHarness({
      [AUDIO_GROUPS]: "{ not json at all",
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video))
    });

    await expect(initAssets(harness)).rejects.toThrow(/legacy assets groups shard/);

    expect(harness.writes.some((write) => write.path.endsWith(MEDIA_GROUPS))).toBe(false);
    expect(harness.present[MEDIA_GROUPS]).toBeUndefined();
  });
});

describe("row order, merging audio + video into media", () => {
  it("concatenates the two legacy orders, audio first, and writes them to the new file", async () => {
    const harness = createHarness({
      [AUDIO_GROUPS]: groupsShard(legacyGroup("group_a", "Chapter 1", AssetType.Audio)),
      [VIDEO_GROUPS]: groupsShard(legacyGroup("group_v", "Cutscenes", AssetType.Video)),
      [AUDIO_METADATA]: metadataShard(assetRecord(AUDIO_A, AssetType.Audio)),
      [VIDEO_METADATA]: metadataShard(assetRecord(VIDEO_B, AssetType.Video)),
      [AUDIO_ORDER]: JSON.stringify({ assetIds: [AUDIO_A], groupIds: ["group_a"] }),
      [VIDEO_ORDER]: JSON.stringify({ assetIds: [VIDEO_B], groupIds: ["group_v"] })
    });

    await initAssets(harness);

    expect(JSON.parse(lastWrite(harness.writes, MEDIA_ORDER)!)).toEqual({
      assetIds: [AUDIO_A, VIDEO_B],
      groupIds: ["group_a", "group_v"]
    });
  });

  it("still lists an id neither legacy order mentioned", async () => {
    // The order file is a hint, never a filter: an asset missing from the browser reads as a
    // failed import, and the author imports it again.
    const harness = createHarness({
      [VIDEO_METADATA]: metadataShard(assetRecord(VIDEO_B, AssetType.Video)),
      [AUDIO_ORDER]: JSON.stringify({ assetIds: [AUDIO_A], groupIds: [] })
    });

    const { metadataManager } = await initAssets(harness);

    expect(metadataManager.listOrdered(AssetType.Video)).toEqual([VIDEO_B]);
  });
});
