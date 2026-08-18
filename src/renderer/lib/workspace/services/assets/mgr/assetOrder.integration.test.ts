import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Fs } from "@shared/utils/fs";
import { FsRequestResult } from "@shared/types/os";
import { AssetOrderManager } from "./AssetOrderManager";
import { AssetsMetadataManager } from "./AssetsMetadataManager";
import { GroupAssetsManager } from "./GroupAssetsManager";
import { AssetsService } from "../../core/AssetsService";
import { ASSET_CATEGORY_ORDER, AssetCategory, AssetType } from "../assetTypes";
import { EMPTY_ASSET_ORDER_TEXT } from "../assetOrder";
import { Services } from "../../services";

/**
 * The asset order path against a real filesystem.
 *
 * Complements `assetOrderMigration.test.ts`, which covers what gets written as pure logic against an
 * in-memory stub. That stub models a write as an entry in a list, so a write API that *refuses* is
 * unrepresentable in it — and it therefore passed while migrating any real project produced seven
 * "Couldn't save assets.order.<type>.json / ENOENT" toasts and never recovered. `writeFileNoFollow`
 * opens with an unconditional `lstat`, by design, so it can only overwrite a file that already
 * exists; the order file, on the one open that matters, never does.
 *
 * What has to be real here is the write itself. `Fs` is the same implementation the renderer reaches
 * over IPC (`appPrivilegedFacade.fs.*` → main → `Fs`), so the rejection contract under test is the
 * one that runs in the app.
 */

const IMAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IMAGE_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let root: string;
let projectPath: string;

function assetRecord(id: string) {
  return {
    id,
    type: "image",
    name: `${id}.png`,
    hash: `h-${id}`,
    ext: "png",
    source: "local",
    meta: {},
    tags: [],
    description: ""
  };
}

function groupRecord(id: string) {
  return { id, name: id, type: "image", createdAt: 0, updatedAt: 0 };
}

/**
 * The `FileSystemService` surface the asset managers use, delegating to the real implementation.
 * Only the methods they call: this is a seam, not a reimplementation.
 */
const filesystemService = {
  read: (p: string, encoding: BufferEncoding) => Fs.read(p, encoding),
  write: (p: string, data: string, encoding: BufferEncoding) => Fs.write(p, data, encoding),
  writeFileNoFollow: (p: string, data: string, encoding: BufferEncoding) =>
    Fs.writeFileNoFollow(p, data, encoding),
  ensureRegularFile: (p: string, data: string, encoding: BufferEncoding) =>
    Fs.ensureRegularFile(p, data, encoding),
  recoverCorruptedJsonFile: (p: string, replacement: string, encoding: BufferEncoding) =>
    Fs.recoverCorruptedJsonFile(p, replacement, encoding),
  isFileExists: (p: string) => Fs.isFileExists(p),
  async readJSON<T>(p: string, encoding: BufferEncoding = "utf-8"): Promise<FsRequestResult<T>> {
    const result = await Fs.read(p, encoding);
    if (!result.ok) {
      return result;
    }
    try {
      return { ok: true, data: JSON.parse(result.data) as T };
    } catch (error) {
      return { ok: false, error: { code: "INVALID_JSON", message: String(error) } as never };
    }
  }
};

function createContext() {
  return {
    project: { resolve: (segments: string[]) => path.join(projectPath, ...segments) },
    services: {
      get(serviceId: Services) {
        if (serviceId === Services.FileSystem) {
          return filesystemService;
        }
        throw new Error(`Unexpected service ${serviceId}`);
      }
    }
  };
}

/** The order `AssetsService.init` brings the three managers up in, against real files. */
async function openProject() {
  const context = createContext();
  const service = new AssetsService();
  service.setContext(context as any);

  const orderManager = await new AssetOrderManager(context as any).init();
  (service as any).assetOrderManager = orderManager;

  const metadataManager = new AssetsMetadataManager(service, context as any);
  (service as any).assetsMetadataManager = metadataManager;
  (service as any).assetsMetadataInitializing = true;
  try {
    await metadataManager.init();
  } finally {
    (service as any).assetsMetadataInitializing = false;
  }
  await service["flushPendingWrites"]();

  const groupManager = await new GroupAssetsManager(service, context as any).init();
  (service as any).groupAssetsManager = groupManager;

  for (const category of orderManager.listMissingCategories()) {
    (service as any).dirtyOrderCategories.add(category);
  }
  await service["flushPendingWrites"]();

  return { service, metadataManager, groupManager, orderManager };
}

function orderFilePath(category: AssetCategory): string {
  return path.join(projectPath, "assets", `assets.order.${category}.json`);
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nls-asset-order-"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  // A fresh project per test: the migration is a once-per-project event, so a shared tree would
  // let the first test perform it and leave the rest asserting against an already-migrated one.
  projectPath = fs.mkdtempSync(path.join(root, "project-"));
  fs.mkdirSync(path.join(projectPath, "assets"));

  for (const type of Object.values(AssetType)) {
    fs.writeFileSync(
      path.join(projectPath, "assets", `assets.metadata.${type}.json`),
      "{}",
      "utf-8"
    );
  }
  for (const category of ASSET_CATEGORY_ORDER) {
    fs.writeFileSync(
      path.join(projectPath, "assets", `assets.groups.${category}.json`),
      "{}",
      "utf-8"
    );
  }

  // An old-shape project: both shards populated, no order file anywhere.
  fs.writeFileSync(
    path.join(projectPath, "assets", "assets.metadata.image.json"),
    JSON.stringify({
      [IMAGE_C]: assetRecord(IMAGE_C),
      [IMAGE_A]: assetRecord(IMAGE_A),
      [IMAGE_B]: assetRecord(IMAGE_B)
    }),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(projectPath, "assets", "assets.groups.image.json"),
    JSON.stringify({ group_2: groupRecord("group_2"), group_1: groupRecord("group_1") }),
    "utf-8"
  );
});

describe("migrating a real project that has no order file", () => {
  it("creates the order file on disk, holding the order recovered from key order", async () => {
    expect(fs.existsSync(orderFilePath(AssetCategory.Image))).toBe(false);

    await openProject();

    expect(fs.existsSync(orderFilePath(AssetCategory.Image))).toBe(true);
    expect(readJsonFile(orderFilePath(AssetCategory.Image))).toEqual({
      assetIds: [IMAGE_C, IMAGE_A, IMAGE_B],
      groupIds: ["group_2", "group_1"]
    });
  });

  it("creates one for every sidebar section, not just the populated one", async () => {
    await openProject();

    for (const category of ASSET_CATEGORY_ORDER) {
      expect(fs.existsSync(orderFilePath(category)), `missing order file for ${category}`).toBe(
        true
      );
    }
  });

  it("leaves both shards exactly as they were: byte-identical, still a bare record", async () => {
    const metadataBefore = fs.readFileSync(
      path.join(projectPath, "assets", "assets.metadata.image.json"),
      "utf-8"
    );
    const groupsBefore = fs.readFileSync(
      path.join(projectPath, "assets", "assets.groups.image.json"),
      "utf-8"
    );

    await openProject();

    expect(
      fs.readFileSync(path.join(projectPath, "assets", "assets.metadata.image.json"), "utf-8")
    ).toBe(metadataBefore);
    expect(
      fs.readFileSync(path.join(projectPath, "assets", "assets.groups.image.json"), "utf-8")
    ).toBe(groupsBefore);
  });

  it("survives the second open: the order is read back, and nothing is rewritten", async () => {
    await openProject();
    const afterMigration = fs.statSync(orderFilePath(AssetCategory.Image)).mtimeMs;

    const reopened = await openProject();

    expect(reopened.metadataManager.listOrdered(AssetType.Image)).toEqual([
      IMAGE_C,
      IMAGE_A,
      IMAGE_B
    ]);
    expect(reopened.groupManager.getGroups(AssetCategory.Image).map((group) => group.id)).toEqual([
      "group_2",
      "group_1"
    ]);
    expect(fs.statSync(orderFilePath(AssetCategory.Image)).mtimeMs).toBe(afterMigration);
  });

  it("uses a writer that creates an absent file — the no-follow one cannot", async () => {
    // The distinction the ENOENT bug turned on, pinned so that "hardening" the order write back
    // to `writeFileNoFollow` fails here rather than in front of an author. Both this manager and
    // the project wizard write the order file with `write` for exactly this reason.
    const absent = path.join(projectPath, "assets", "writer-contract.json");

    expect((await Fs.write(absent, "{}", "utf-8")).ok).toBe(true);
    expect(fs.existsSync(absent)).toBe(true);

    const neverWritten = path.join(projectPath, "assets", "writer-contract-nofollow.json");
    const noFollow = await Fs.writeFileNoFollow(neverWritten, "{}", "utf-8");
    expect(noFollow.ok).toBe(false);
    expect(fs.existsSync(neverWritten)).toBe(false);
  });

  it("persists an import made after the migration, at the end of the order", async () => {
    const { service, metadataManager } = await openProject();

    metadataManager.getAssets()[AssetType.Image][IMAGE_B] = assetRecord(IMAGE_B) as never;
    await service.transaction(() => {
      service.markDirty(AssetType.Image);
    });

    expect(
      (readJsonFile(orderFilePath(AssetCategory.Image)) as { assetIds: string[] }).assetIds
    ).toEqual([IMAGE_C, IMAGE_A, IMAGE_B]);
  });
});

describe("a project created the way the wizard creates one", () => {
  /** What `projectService.createProject` lays down for each type: two bare shards and an order file. */
  function layDownWizardProject(): void {
    for (const type of Object.values(AssetType)) {
      fs.writeFileSync(
        path.join(projectPath, "assets", `assets.metadata.${type}.json`),
        "{}",
        "utf-8"
      );
    }
    for (const category of ASSET_CATEGORY_ORDER) {
      fs.writeFileSync(
        path.join(projectPath, "assets", `assets.groups.${category}.json`),
        "{}",
        "utf-8"
      );
      fs.writeFileSync(
        path.join(projectPath, "assets", `assets.order.${category}.json`),
        EMPTY_ASSET_ORDER_TEXT,
        "utf-8"
      );
    }
  }

  it("opens with nothing to migrate and nothing rewritten", async () => {
    layDownWizardProject();
    const before = ASSET_CATEGORY_ORDER.map(
      (category) => fs.statSync(orderFilePath(category)).mtimeMs
    );

    const { metadataManager, groupManager, orderManager } = await openProject();

    expect(orderManager.listMissingCategories()).toEqual([]);
    expect(metadataManager.listOrdered(AssetType.Image)).toEqual([]);
    expect(groupManager.getGroups(AssetCategory.Image)).toEqual([]);
    expect(
      ASSET_CATEGORY_ORDER.map((category) => fs.statSync(orderFilePath(category)).mtimeMs)
    ).toEqual(before);
  });

  it("records the order of the first assets imported into it", async () => {
    layDownWizardProject();
    const { service, metadataManager } = await openProject();

    await service.transaction(() => {
      for (const id of [IMAGE_B, IMAGE_C]) {
        metadataManager.getAssets()[AssetType.Image][id] = assetRecord(id) as never;
      }
      service.markDirty(AssetType.Image);
    });

    expect(readJsonFile(orderFilePath(AssetCategory.Image))).toEqual({
      assetIds: [IMAGE_B, IMAGE_C],
      groupIds: []
    });
  });
});
