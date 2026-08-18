import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { CharacterService } from "./CharacterService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A cast plus the two stores a deletion touches, with no filesystem behind either.
 *
 * `flush` is left to fire and fail into the storage stub on purpose - the point of these tests is
 * what is in memory and what came back, and a service that only behaves when its save succeeds
 * would be the more interesting defect.
 */
function createHarness() {
  const history = new HistoryService();
  const service = new CharacterService();

  const files = new Map<string, Uint8Array>();
  const locks: string[] = [];
  let nextId = 0;

  const serviceAssets = {
    deleteFile: vi.fn(async (fileId: string) => {
      files.delete(fileId);
      return { ok: true as const, data: undefined };
    }),
    readRaw: vi.fn(async (fileId: string) => {
      const bytes = files.get(fileId);
      return bytes ? { ok: true as const, data: bytes } : { ok: false as const, error: "missing" };
    }),
    restoreFile: vi.fn(async (fileId: string, bytes: Uint8Array) => {
      files.set(fileId, bytes);
      return { ok: true as const, data: undefined };
    })
  };
  const assets = {
    lockAsset: vi.fn((assetId: string) => void locks.push(`lock:${assetId}`)),
    unlockAsset: vi.fn((assetId: string) => void locks.push(`unlock:${assetId}`))
  };

  const context = {
    project: {} as never,
    services: {
      get(id: Services) {
        switch (id) {
          case Services.History:
            return history;
          case Services.ServiceAssets:
            return serviceAssets;
          case Services.Assets:
            return assets;
          case Services.Uuid:
            return { generate: () => `id-${++nextId}` };
          case Services.UI:
            return { showError: vi.fn() };
          case Services.FileSystem:
            return {};
          default:
            throw new Error(`Unexpected service ${id}`);
        }
      }
    } as never
  };
  history.setContext(context);
  service.setContext(context);
  return { service, history, files, locks, serviceAssets, assets };
}

describe("CharacterService deletion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the character back where it was in the cast order", async () => {
    const { service, history } = createHarness();
    service.createCharacter("Ada");
    const bea = service.createCharacter("Bea");
    service.createCharacter("Cy");

    await service.deleteCharacter(bea.profile.getId());
    expect(service.listCharacter().map((c) => c.profile.getName())).toEqual(["Ada", "Cy"]);

    expect(history.undo(projectHistoryScope())).toBe(true);
    await history.settled();
    // Appending would restore the cast and silently reorder the panel - a second edit the
    // author did not ask for.
    expect(service.listCharacter().map((c) => c.profile.getName())).toEqual(["Ada", "Bea", "Cy"]);
  });

  it("restores the baked avatar at its original file id", async () => {
    const { service, history, files } = createHarness();
    const character = service.createCharacter("Ada");
    const id = character.profile.getId();
    character.profile.setThumbnail("avatar-1");
    files.set("avatar-1", new Uint8Array([1, 2, 3]));

    await service.deleteCharacter(id);
    expect(files.has("avatar-1")).toBe(false);

    history.undo(projectHistoryScope());
    await history.settled();
    // The same id, not a fresh one: the restored record still names "avatar-1", so a new id
    // would leave the avatar dangling and rewrite the document undo was meant to restore.
    expect(files.get("avatar-1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(service.getCharacter(id)?.profile.getThumbnail()).toBe("avatar-1");
  });

  it("survives a character whose avatar file has already gone", async () => {
    const { service, history } = createHarness();
    const character = service.createCharacter("Ada");
    character.profile.setThumbnail("avatar-missing");

    await service.deleteCharacter(character.profile.getId());
    expect(history.undo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(service.listCharacter().map((c) => c.profile.getName())).toEqual(["Ada"]);
  });

  it("redoes the deletion", async () => {
    const { service, history } = createHarness();
    const character = service.createCharacter("Ada");

    await service.deleteCharacter(character.profile.getId());
    history.undo(projectHistoryScope());
    await history.settled();
    expect(service.listCharacter()).toHaveLength(1);

    expect(history.redo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(service.listCharacter()).toHaveLength(0);
  });

  it("puts a group's members back in it, not just the group", async () => {
    const { service, history } = createHarness();
    const group = service.createGroup("Cast");
    const ada = service.createCharacter("Ada");
    const bea = service.createCharacter("Bea");
    service.assignCharacterToGroup(ada.profile.getId(), group.id);
    service.assignCharacterToGroup(bea.profile.getId(), group.id);

    await service.deleteGroup(group.id);
    expect(service.getGroup(group.id)).toBeUndefined();
    expect(ada.profile.getGroupId()).toBeUndefined();

    expect(history.undo(projectHistoryScope())).toBe(true);
    await history.settled();
    expect(service.getGroup(group.id)?.name).toBe("Cast");
    expect(service.listCharactersByGroup(group.id).map((c) => c.profile.getName())).toEqual([
      "Ada",
      "Bea"
    ]);
  });

  it("records nothing for a character that was not there", async () => {
    const { service, history } = createHarness();
    expect(await service.deleteCharacter("nobody")).toBe(false);
    expect(history.canUndo(projectHistoryScope())).toBe(false);
  });

  it("re-locks the restored character's assets", async () => {
    const { service, history, locks } = createHarness();
    const character = service.createCharacter("Ada");
    character.profile.appearance.createPose("Idle");
    const poses = character.profile.appearance.getPoses();
    character.profile.appearance.setPoseAsset(poses[0].id, "asset-7");
    locks.length = 0;

    await service.deleteCharacter(character.profile.getId());
    expect(locks).toContain("unlock:asset-7");

    history.undo(projectHistoryScope());
    await history.settled();
    // Without this the restored character would render but the asset would look unused, and
    // deleting it afterwards would not even warn.
    expect(locks).toContain("lock:asset-7");
  });
});
