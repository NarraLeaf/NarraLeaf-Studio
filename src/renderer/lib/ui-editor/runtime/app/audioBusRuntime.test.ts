/**
 * The two halves of the mixer's runtime: the shape declared at boot, and the volumes persisted
 * across launches.
 *
 * The second half is the one worth guarding hardest, because its failure mode is invisible in
 * every test that does not look for it: the game runs, the slider moves, the sound changes - and
 * the next launch is back at the author's defaults. That is the state Studio shipped in, since
 * the engine has no persistence of its own and no volume ever reached scope persistence.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProjectAudioTrack } from "@shared/types/audioTrack";
import {
  AUDIO_BUS_VOLUMES_PERSISTENCE_KEY,
  attachAudioBusPersistence,
  audioTracksToBusDeclarations,
  readPersistedBusVolumes,
  type AudioBusMixerLike
} from "./audioBusRuntime";

const TRACKS: ProjectAudioTrack[] = [
  { id: "bgm", name: "Music", parentId: null, volume: 1, loop: true, builtin: true },
  { id: "sound", name: "SFX", parentId: null, volume: 1, loop: false, builtin: true },
  { id: "voice", name: "Voice", parentId: null, volume: 1, loop: false, builtin: true },
  { id: "cast", name: "Cast", parentId: "voice", volume: 0.9, loop: false },
  { id: "alice", name: "Alice", parentId: "cast", volume: 0.7, loop: false }
];

describe("audioTracksToBusDeclarations", () => {
  it("emits every track as a bus, parents before their children", () => {
    const declarations = audioTracksToBusDeclarations(TRACKS);

    expect(declarations.map((bus) => bus.id)).toEqual(["bgm", "sound", "voice", "cast", "alice"]);
    expect(declarations.at(-1)).toEqual({ id: "alice", parentId: "cast", volume: 0.7 });
    // Every parent has already been seen by the time its child is emitted.
    const seen = new Set<string>();
    for (const bus of declarations) {
      expect(bus.parentId == null || seen.has(bus.parentId)).toBe(true);
      seen.add(bus.id);
    }
  });

  it("declares the seeded three for a project with no tracks", () => {
    // Absent is the ordinary case for a project that has never opened the Audio surface, and it
    // has to produce the pre-bus behaviour rather than an empty mixer.
    expect(audioTracksToBusDeclarations(undefined).map((bus) => bus.id)).toEqual([
      "bgm",
      "sound",
      "voice"
    ]);
  });

  it("repairs a tree the engine would throw on", () => {
    // `AudioBusTree.resolve` rejects a cycle and an unknown parent, and it does so lazily - the
    // first time something plays. Normalizing here is what keeps a hand-edited file from
    // becoming a game that boots and then goes silent with an exception nobody sees.
    const declarations = audioTracksToBusDeclarations([
      { id: "a", name: "A", parentId: "b", volume: 1, loop: false },
      { id: "b", name: "B", parentId: "a", volume: 1, loop: false },
      { id: "orphan", name: "Orphan", parentId: "nowhere", volume: 2, loop: false }
    ]);
    const byId = Object.fromEntries(declarations.map((bus) => [bus.id, bus]));

    expect(byId.orphan.parentId).toBeNull();
    expect(byId.orphan.volume).toBe(1);
    expect([byId.a.parentId, byId.b.parentId].filter((parent) => parent === null)).toHaveLength(1);
  });
});

describe("readPersistedBusVolumes", () => {
  it("keeps well-formed entries and clamps them into the range a bus gain accepts", () => {
    expect(readPersistedBusVolumes({ alice: 0.4, cast: 1.9, bgm: -1 })).toEqual({
      alice: 0.4,
      cast: 1,
      bgm: 0
    });
  });

  it("reads anything unusable as nothing saved", () => {
    // Landing on the author's declared volumes is the right degrade; refusing to boot is not.
    for (const raw of [null, undefined, "{}", 7, [1, 2]]) {
      expect(readPersistedBusVolumes(raw)).toEqual({});
    }
    expect(readPersistedBusVolumes({ alice: "loud", "": 1, bad: Number.NaN })).toEqual({});
  });
});

function createMixer(): AudioBusMixerLike & {
  volumes: Record<string, number>;
  fire: (id: string, volume: number) => void;
} {
  const listeners: Array<(id: string, volume: number) => void> = [];
  const volumes: Record<string, number> = { bgm: 1, sound: 1, voice: 1 };
  return {
    volumes,
    setVolumes: (next) => Object.assign(volumes, next),
    getVolumes: () => ({ ...volumes }),
    onVolumeChange: (listener) => {
      listeners.push(listener);
      return { cancel: () => void listeners.splice(listeners.indexOf(listener), 1) };
    },
    fire: (id, volume) => {
      volumes[id] = volume;
      for (const listener of [...listeners]) {
        listener(id, volume);
      }
    }
  };
}

describe("attachAudioBusPersistence", () => {
  it("restores the saved volumes and writes the whole map back on every change", async () => {
    const mixer = createMixer();
    const store: Record<string, unknown> = {
      [AUDIO_BUS_VOLUMES_PERSISTENCE_KEY]: { alice: 0.2, bgm: 0.6 }
    };
    const write = vi.fn((key: string, value: unknown) => void (store[key] = value));

    const dispose = await attachAudioBusPersistence({
      mixer,
      read: (key) => store[key],
      write
    });

    expect(mixer.volumes).toMatchObject({ alice: 0.2, bgm: 0.6 });
    mixer.fire("bgm", 0.3);
    // The whole map, not the one bus that moved: a partial write would leave half the mixer at
    // the author's defaults and half at the player's after a crash between two drags.
    expect(write).toHaveBeenCalledWith(AUDIO_BUS_VOLUMES_PERSISTENCE_KEY, {
      bgm: 0.3,
      sound: 1,
      voice: 1,
      alice: 0.2
    });
    dispose();
    mixer.fire("bgm", 0.9);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("restores a bus id the tree no longer has without complaint", async () => {
    // An author deletes `alice`; the player's saved value for it must not be the thing that
    // breaks the restore of everything else.
    const mixer = createMixer();
    const setVolumes = vi.spyOn(mixer, "setVolumes");

    await attachAudioBusPersistence({
      mixer,
      read: () => ({ ghost: 0.1, bgm: 0.5 }),
      write: () => undefined
    });

    expect(setVolumes).toHaveBeenCalledWith({ ghost: 0.1, bgm: 0.5 });
    expect(mixer.volumes.bgm).toBe(0.5);
  });

  it("survives a store that cannot be read", async () => {
    const mixer = createMixer();
    const logged: string[] = [];

    const dispose = await attachAudioBusPersistence({
      mixer,
      read: () => {
        throw new Error("no store");
      },
      write: () => undefined,
      log: (_level, message) => void logged.push(message)
    });

    expect(logged).toHaveLength(1);
    // Still subscribed: an unreadable store is a player who starts at the declared volumes, not
    // a player whose later changes stop being saved.
    expect(() => dispose()).not.toThrow();
  });

  it("notifies host listeners even when the write fails", async () => {
    const mixer = createMixer();
    const changed = vi.fn();

    await attachAudioBusPersistence({
      mixer,
      read: () => ({}),
      write: () => {
        throw new Error("disk full");
      },
      onVolumeChange: changed,
      log: () => undefined
    });
    mixer.fire("bgm", 0.2);

    // A slider that visibly does nothing is worse than one whose value is not kept.
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on an engine build with no mixer", async () => {
    const dispose = await attachAudioBusPersistence({
      mixer: undefined,
      read: () => ({ bgm: 0.5 }),
      write: () => {
        throw new Error("must not be called");
      }
    });

    expect(() => dispose()).not.toThrow();
  });
});
