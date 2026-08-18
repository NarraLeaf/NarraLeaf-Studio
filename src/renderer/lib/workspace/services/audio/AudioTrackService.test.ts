import { describe, expect, it, vi } from "vitest";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { join } from "@shared/utils/path";
import {
  AUDIO_TRACK_ID_BGM,
  AUDIO_TRACK_ID_SOUND,
  AUDIO_TRACK_ID_VOICE,
  AUDIO_TRACK_SCHEMA_VERSION
} from "@shared/types/audioTrack";
import { Services, type WorkspaceContext } from "../services";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { AudioTrackService } from "./AudioTrackService";

/**
 * The service end of the bus tree: reads through `loadDocument`, writes through `saveDocument`,
 * seeded from absence, migrated from v1, and the same "refuse to write over a file we could not
 * read" latch every adopted document service carries.
 */

const ROOT = join("D:/projects", "my-game");
const DOCUMENT = join(ROOT, "editor", "audio-tracks.json");

type Harness = {
  service: AudioTrackService;
  files: Map<string, string>;
  unreadable: ReturnType<typeof vi.fn>;
  /** The real service, not a stub: every mutation is meant to leave a step on the project stack. */
  history: HistoryService;
};

async function createHarness(
  seed?: string,
  reuse?: AudioTrackService,
  reuseHistory?: HistoryService
): Promise<Harness> {
  const files = new Map<string, string>();
  if (seed !== undefined) {
    files.set(DOCUMENT, seed);
  }
  const unreadable = vi.fn();
  const history = reuseHistory ?? new HistoryService();
  let nextId = 0;

  const ok = <T>(data: T): FsRequestResult<T> => ({ ok: true, data });
  const stubs: Record<string, unknown> = {
    [Services.FileSystem]: {
      read: async (path: string) => {
        const value = files.get(path);
        return value === undefined
          ? { ok: false, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } }
          : ok(value);
      },
      write: async (path: string, data: string) => {
        files.set(path, data);
        return ok(undefined);
      },
      createDir: async () => ok(undefined),
      copyFile: async (src: string, dest: string) => {
        files.set(dest, files.get(src) ?? "");
        return ok(undefined);
      }
    },
    [Services.Project]: {},
    [Services.Uuid]: { generate: () => `track-${++nextId}` },
    [Services.SaveStatus]: { register: () => undefined, reportUnreadableDocument: unreadable },
    [Services.History]: history
  };

  const ctx = {
    project: { getConfig: () => ({ projectPath: ROOT }) },
    services: {
      get: (id: string) => {
        const stub = stubs[id];
        if (!stub) {
          throw new Error(`Service ${id} not found`);
        }
        return stub;
      }
    }
  } as unknown as WorkspaceContext;

  const service = reuse ?? new AudioTrackService();
  await service.initialize(ctx, async () => undefined);

  return { service, files, unreadable, history };
}

const ids = (service: AudioTrackService): string[] => service.listTracks().map((track) => track.id);

describe("AudioTrackService document adoption", () => {
  it("seeds the three buses on a project that has never had one", async () => {
    const { service, files } = await createHarness();

    expect(ids(service)).toEqual([AUDIO_TRACK_ID_BGM, AUDIO_TRACK_ID_SOUND, AUDIO_TRACK_ID_VOICE]);
    expect(service.listTracks().every((track) => track.parentId === null)).toBe(true);
    // Written on first open, not on first edit: version control has to see the document from the
    // moment the project is opened.
    expect(files.get(DOCUMENT)).toContain('"tracks"');
    expect(files.get(DOCUMENT)?.endsWith("\n")).toBe(true);
  });

  it("seeds an empty track list rather than leaving the project with no fallbacks", async () => {
    const { service } = await createHarness(
      `{\n  "schemaVersion": ${AUDIO_TRACK_SCHEMA_VERSION},\n  "tracks": []\n}\n`
    );

    expect(service.listTracks()).toHaveLength(3);
  });

  it("reads a stored child bus back with its parent intact", async () => {
    const stored = JSON.stringify({
      schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
      tracks: [
        { id: "alice", name: "Alice", parentId: AUDIO_TRACK_ID_VOICE, volume: 0.5, loop: false }
      ]
    });
    const { service } = await createHarness(stored);

    expect(ids(service)).toEqual([
      AUDIO_TRACK_ID_BGM,
      AUDIO_TRACK_ID_SOUND,
      AUDIO_TRACK_ID_VOICE,
      "alice"
    ]);
    expect(service.getTrack("alice")).toMatchObject({
      parentId: AUDIO_TRACK_ID_VOICE,
      volume: 0.5
    });
  });

  /** The v1 preset list, as an existing project on disk would have it. */
  it("migrates a v1 document into buses on load", async () => {
    const stored = JSON.stringify({
      schemaVersion: 1,
      tracks: [
        {
          id: "music",
          name: "Score",
          channel: "bgm",
          gain: 1.6,
          fadeInMs: 800,
          fadeOutMs: 800,
          loop: true
        },
        {
          id: "sfx",
          name: "SFX",
          channel: "sound",
          gain: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
          loop: false
        },
        {
          id: "voice",
          name: "Voice",
          channel: "voice",
          gain: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
          loop: false
        },
        {
          id: "ambience",
          name: "Ambience",
          channel: "bgm",
          gain: 0.4,
          fadeInMs: 1500,
          fadeOutMs: 0,
          loop: true
        }
      ]
    });
    const { service } = await createHarness(stored);

    expect(ids(service)).toEqual([
      AUDIO_TRACK_ID_BGM,
      AUDIO_TRACK_ID_SOUND,
      AUDIO_TRACK_ID_VOICE,
      "ambience"
    ]);
    // The author's rename survives; the >1 gain is clamped where the runtime clamps.
    expect(service.getTrack(AUDIO_TRACK_ID_BGM)).toMatchObject({
      name: "Score",
      volume: 1,
      loop: true
    });
    expect(service.getTrack("ambience")).toMatchObject({
      parentId: AUDIO_TRACK_ID_BGM,
      volume: 0.4
    });
    // References written under v1 still answer, without any document being rewritten.
    expect(service.resolveTrack("music").id).toBe(AUDIO_TRACK_ID_BGM);
    expect(service.resolveTrack("sfx").id).toBe(AUDIO_TRACK_ID_SOUND);
  });

  it("writes canonical bytes at the new schema version", async () => {
    const { service, files } = await createHarness();

    service.createTrack({ name: "Ambience", parentId: AUDIO_TRACK_ID_BGM });
    await service.flushPendingChanges();

    const text = files.get(DOCUMENT) ?? "";
    expect(text).toContain(`"schemaVersion": ${AUDIO_TRACK_SCHEMA_VERSION}`);
    expect(text).toContain('"name": "Ambience"');
    expect(text).toContain('"parentId": null');
    expect(text).not.toContain("fade");
    expect(text).not.toContain('"channel"');
  });

  /** The canonical encoder refuses an explicit `undefined` by name. A custom track has no `builtin`. */
  it("saves a custom track without an undefined builtin flag", async () => {
    const { service, files } = await createHarness();

    const track = service.createTrack({ name: "Ambience" });
    await service.flushPendingChanges();

    expect("builtin" in track).toBe(false);
    expect(files.get(DOCUMENT)).toContain('"builtin": true');
    expect(files.get(DOCUMENT)?.match(/"builtin"/g) ?? []).toHaveLength(3);
  });
});

describe("AudioTrackService mutations", () => {
  it("clamps whatever a caller asks for, so the invariants hold between saves too", async () => {
    const { service } = await createHarness();

    const track = service.createTrack({ name: "Loud", volume: 99 });

    expect(service.getTrack(track.id)).toMatchObject({ volume: 1 });
  });

  it("roots a new track whose requested parent is not there", async () => {
    const { service } = await createHarness();

    const track = service.createTrack({ name: "Orphan", parentId: "nope" });

    expect(service.getTrack(track.id)!.parentId).toBeNull();
  });

  it("renames and re-tunes a seeded bus, and re-parents it like any other", async () => {
    const { service } = await createHarness();
    const submix = service.createTrack({ name: "Submix" });

    service.renameTrack(AUDIO_TRACK_ID_BGM, "Score");
    service.updateTrack(AUDIO_TRACK_ID_BGM, { volume: 0.4, loop: false });
    expect(service.reparentTrack(AUDIO_TRACK_ID_BGM, submix.id)).toBe(true);

    expect(service.getTrack(AUDIO_TRACK_ID_BGM)).toEqual({
      id: AUDIO_TRACK_ID_BGM,
      name: "Score",
      parentId: submix.id,
      volume: 0.4,
      loop: false,
      builtin: true
    });
  });

  it("refuses a blank rename rather than falling the name back to the id", async () => {
    const { service } = await createHarness();

    expect(service.renameTrack(AUDIO_TRACK_ID_BGM, "   ")).toBe(false);
    expect(service.renameTrack("nope", "Anything")).toBe(false);
    expect(service.getTrack(AUDIO_TRACK_ID_BGM)!.name).toBe("Music");
  });

  it("refuses a re-parent that would make a cycle, and leaves the tree alone", async () => {
    const { service } = await createHarness();
    const alice = service.createTrack({ name: "Alice", parentId: AUDIO_TRACK_ID_VOICE });
    const whisper = service.createTrack({ name: "Whisper", parentId: alice.id });

    expect(service.canReparentTrack(alice.id, alice.id)).toBe(false);
    expect(service.canReparentTrack(alice.id, whisper.id)).toBe(false);
    expect(service.reparentTrack(alice.id, whisper.id)).toBe(false);
    expect(service.reparentTrack(alice.id, "nope")).toBe(false);
    expect(service.reparentTrack("nope", null)).toBe(false);

    expect(service.getTrack(alice.id)!.parentId).toBe(AUDIO_TRACK_ID_VOICE);
    expect(service.canReparentTrack(alice.id, null)).toBe(true);
    expect(service.reparentTrack(alice.id, null)).toBe(true);
    expect(service.getTrack(alice.id)!.parentId).toBeNull();
  });

  it("places a duplicate directly after its source, under the same parent", async () => {
    const { service } = await createHarness();
    const first = service.createTrack({
      name: "Ambience",
      parentId: AUDIO_TRACK_ID_BGM,
      volume: 0.5,
      loop: true
    });
    service.createTrack({ name: "UI" });

    const copy = service.duplicateTrack(first.id)!;

    expect(
      service
        .listTracks()
        .map((track) => track.name)
        .slice(3)
    ).toEqual(["Ambience", "Ambience 2", "UI"]);
    expect(copy).toMatchObject({ parentId: AUDIO_TRACK_ID_BGM, volume: 0.5, loop: true });
    expect(copy.id).not.toBe(first.id);
  });

  it("leaves the children on the original when a bus is duplicated", async () => {
    const { service } = await createHarness();
    const alice = service.createTrack({ name: "Alice", parentId: AUDIO_TRACK_ID_VOICE });
    const whisper = service.createTrack({ name: "Whisper", parentId: alice.id });

    const copy = service.duplicateTrack(alice.id)!;

    expect(service.getTrack(whisper.id)!.parentId).toBe(alice.id);
    expect(service.listTracks().filter((track) => track.parentId === copy.id)).toEqual([]);
  });

  it("refuses to delete a seeded bus and deletes a custom one", async () => {
    const { service } = await createHarness();
    const track = service.createTrack({ name: "Ambience" });

    expect(service.deleteTrack(AUDIO_TRACK_ID_BGM)).toBe(false);
    expect(service.getTrack(AUDIO_TRACK_ID_BGM)).toBeDefined();
    expect(service.deleteTrack(track.id)).toBe(true);
    expect(service.getTrack(track.id)).toBeUndefined();
    expect(service.deleteTrack(track.id)).toBe(false);
  });

  /**
   * The non-destructive answer: a cascade would take out an arbitrary amount of the author's
   * mixer behind one confirm, and refusing outright would make them hand-move every child first.
   */
  it("promotes the children of a deleted bus to its own parent", async () => {
    const { service } = await createHarness();
    const party = service.createTrack({ name: "Party", parentId: AUDIO_TRACK_ID_VOICE });
    const alice = service.createTrack({ name: "Alice", parentId: party.id });
    const bob = service.createTrack({ name: "Bob", parentId: party.id });
    const whisper = service.createTrack({ name: "Whisper", parentId: alice.id });

    expect(service.deleteTrack(party.id)).toBe(true);

    expect(service.getTrack(alice.id)!.parentId).toBe(AUDIO_TRACK_ID_VOICE);
    expect(service.getTrack(bob.id)!.parentId).toBe(AUDIO_TRACK_ID_VOICE);
    // Only one level moves: the grandchild keeps the parent it always had.
    expect(service.getTrack(whisper.id)!.parentId).toBe(alice.id);
  });

  it("promotes a deleted root bus's children to the root", async () => {
    const { service } = await createHarness();
    const submix = service.createTrack({ name: "Submix" });
    const child = service.createTrack({ name: "Child", parentId: submix.id });

    service.deleteTrack(submix.id);

    expect(service.getTrack(child.id)!.parentId).toBeNull();
  });

  it("resolves a live id, and falls a dangling one back onto the seeded bus for its shape", async () => {
    const { service } = await createHarness();
    const track = service.createTrack({ name: "Ambience", parentId: AUDIO_TRACK_ID_BGM });

    expect(service.resolveTrack(track.id).id).toBe(track.id);
    service.deleteTrack(track.id);
    expect(service.resolveTrack(track.id, "bgm").id).toBe(AUDIO_TRACK_ID_BGM);
    expect(service.resolveTrack(undefined, "voice").id).toBe(AUDIO_TRACK_ID_VOICE);
  });

  it("reports dirty and clean around a flush, and bumps the revision per mutation", async () => {
    const { service } = await createHarness();
    const dirtyStates: boolean[] = [];
    service.onDirtyChanged((value) => dirtyStates.push(value));

    const before = service.getRevision();
    service.createTrack({ name: "Ambience" });
    expect(service.isDirty()).toBe(true);
    expect(service.getRevision()).toBe(before + 1);

    await service.flushPendingChanges();
    expect(service.isDirty()).toBe(false);
    expect(dirtyStates).toEqual([true, false]);
  });

  it("tells its subscribers on every mutation", async () => {
    const { service } = await createHarness();
    const seen: number[] = [];
    const unsubscribe = service.onTracksChanged((tracks) => seen.push(tracks.length));

    const track = service.createTrack({ name: "Ambience" });
    service.updateTrack(track.id, { volume: 0.5 });
    service.deleteTrack(track.id);
    unsubscribe();
    service.createTrack({ name: "UI" });

    expect(seen).toEqual([4, 4, 3]);
  });

  /** Order is sibling order; the tree comes from `parentId`, so anything may move anywhere. */
  it("reorders any track, seeded buses included", async () => {
    const { service } = await createHarness();
    const ambience = service.createTrack({ name: "Ambience" });
    const ui = service.createTrack({ name: "UI" });

    service.moveTrack(ui.id, ambience.id);
    expect(
      service
        .listTracks()
        .map((track) => track.name)
        .slice(3)
    ).toEqual(["UI", "Ambience"]);

    service.moveTrack(ui.id, AUDIO_TRACK_ID_BGM);
    expect(ids(service)[0]).toBe(ui.id);

    service.moveTrack(ui.id, null);
    expect(ids(service).at(-1)).toBe(ui.id);
  });
});

describe("AudioTrackService when the file on disk cannot be read", () => {
  const BROKEN = '{"tracks": [{"id": "ambience"';

  it("opens the project anyway, and reports the failure where the author can see it", async () => {
    const { service, unreadable } = await createHarness(BROKEN);

    expect(unreadable).toHaveBeenCalledTimes(1);
    expect(unreadable.mock.calls[0][0].path).toBe("editor/audio-tracks.json");
    expect(service.listTracks()).toHaveLength(3);
  });

  /** Writing the bare seed over it would turn "unreadable" into "the author's tracks are gone". */
  it("refuses to write, rather than replacing it with the defaults", async () => {
    const { service, files } = await createHarness(BROKEN);

    await expect(service.save(service.getDocument())).rejects.toThrow(/could not be read/);
    await expect(service.flushPendingChanges()).resolves.toBeUndefined();
    expect(files.get(DOCUMENT)).toBe(BROKEN);
  });

  it("leaves the original bytes in place and keeps a copy", async () => {
    const { files } = await createHarness(BROKEN);

    expect(files.get(DOCUMENT)).toBe(BROKEN);
    const quarantined = [...files.keys()].filter((path) => path.includes("quarantine"));
    expect(quarantined).toHaveLength(1);
    expect(files.get(quarantined[0])).toBe(BROKEN);
  });

  /** These services are singletons, so the refusal has to be per-project, not per-process. */
  it("does not follow the author into the next project they open", async () => {
    const broken = await createHarness(BROKEN);

    const healthy = await createHarness(undefined, broken.service);

    expect(healthy.files.get(DOCUMENT)).toContain('"tracks"');
    healthy.service.createTrack({ name: "Ambience" });
    await expect(healthy.service.flushPendingChanges()).resolves.toBeUndefined();
  });

  /** A document with a cycle in it is a bad document, not an unopenable project. */
  it("opens a project whose document has a cycle, with the cycle broken", async () => {
    const cyclic = JSON.stringify({
      schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
      tracks: [
        { id: "a", name: "A", parentId: "b", volume: 1, loop: false },
        { id: "b", name: "B", parentId: "a", volume: 1, loop: false }
      ]
    });
    const { service, unreadable } = await createHarness(cyclic);

    expect(unreadable).not.toHaveBeenCalled();
    expect(ids(service)).toContain("a");
    expect(ids(service)).toContain("b");
    const roots = service.listTracks().filter((track) => track.parentId === null);
    expect(roots.map((track) => track.id)).toContain("a");
  });
});

/**
 * Deleting a bus promotes its children and rewrites nothing that pointed at it, so before these
 * mutations reached the project's undo stack a mis-click past the confirmation was permanent.
 */
describe("audio track undo", () => {
  it("puts a deleted track and its routing back", async () => {
    const { service, history } = await createHarness();
    const parent = service.createTrack({ name: "Ambience" });
    const child = service.createTrack({ name: "Rain", parentId: parent.id });

    service.deleteTrack(parent.id);
    expect(service.getTrack(parent.id)).toBeUndefined();
    // Promotion, which is what an undo has to reverse as well as the deletion itself.
    expect(service.getTrack(child.id)?.parentId).toBeNull();

    expect(history.undo(projectHistoryScope())).toBe(true);
    expect(service.getTrack(parent.id)?.name).toBe("Ambience");
    expect(service.getTrack(child.id)?.parentId).toBe(parent.id);
  });

  it("redoes what it undid, and reports the track by name", async () => {
    const { service, history } = await createHarness();
    const track = service.createTrack({ name: "Ambience" });

    history.undo(projectHistoryScope());
    expect(service.getTrack(track.id)).toBeUndefined();

    expect(history.redo(projectHistoryScope())).toBe(true);
    expect(service.getTrack(track.id)?.name).toBe("Ambience");
    expect(history.peekUndo(projectHistoryScope())).toEqual({
      key: "project.audio.history.add",
      params: { name: "Ambience" }
    });
  });

  it("undoes a volume edit without touching the rest of the tree", async () => {
    const { service, history } = await createHarness();
    const track = service.createTrack({ name: "Ambience", volume: 0.5 });

    service.updateTrack(track.id, { volume: 0.2 });
    expect(service.getTrack(track.id)?.volume).toBe(0.2);

    history.undo(projectHistoryScope());
    expect(service.getTrack(track.id)?.volume).toBe(0.5);
    // The track itself is still there: the step undone is the edit, not its creation.
    expect(service.getTrack(track.id)?.name).toBe("Ambience");
  });
});
