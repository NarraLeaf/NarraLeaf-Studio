import { describe, expect, it } from "vitest";
import {
  AUDIO_TRACK_ID_BGM,
  AUDIO_TRACK_ID_SOUND,
  AUDIO_TRACK_ID_VOICE,
  AUDIO_TRACK_MAX_DEPTH,
  AUDIO_TRACK_SCHEMA_VERSION,
  BUILTIN_AUDIO_TRACKS,
  DEFAULT_AUDIO_TRACK_ID,
  audioTrackChildren,
  audioTrackDescendantIds,
  countAudioTrackReferences,
  createSeededAudioTrackDocument,
  flattenAudioTrackTree,
  migrateProjectAudioTrackDocument,
  normalizeAudioTrackChannel,
  normalizeProjectAudioTrack,
  normalizeProjectAudioTracks,
  resolveAudioTrack,
  resolveAudioTrackBusGain,
  resolveAudioTrackChain,
  resolveAudioTrackPlayback,
  resolveMixedElementVolume,
  type ProjectAudioTrack
} from "./audioTrack";

const custom = (patch: Partial<ProjectAudioTrack> & { id: string }): ProjectAudioTrack => ({
  name: patch.id,
  parentId: null,
  volume: 1,
  loop: false,
  ...patch
});

const ids = (tracks: readonly ProjectAudioTrack[]): string[] => tracks.map((track) => track.id);

describe("the seeded buses", () => {
  it("carries the ids the engine's channels have always had, all under master", () => {
    expect(BUILTIN_AUDIO_TRACKS.map((track) => [track.id, track.name, track.parentId])).toEqual([
      [AUDIO_TRACK_ID_BGM, "Music", null],
      [AUDIO_TRACK_ID_SOUND, "SFX", null],
      [AUDIO_TRACK_ID_VOICE, "Voice", null]
    ]);
  });

  /** Studio's behaviour before tracks existed, restated as data. Changing these changes every project. */
  it("reproduces the pre-track loop defaults at unity gain", () => {
    const [bgm, sound, voice] = BUILTIN_AUDIO_TRACKS;
    expect(bgm).toMatchObject({ volume: 1, loop: true, builtin: true });
    expect(sound).toMatchObject({ volume: 1, loop: false, builtin: true });
    expect(voice).toMatchObject({ volume: 1, loop: false, builtin: true });
  });

  it("carries no channel and no fades", () => {
    for (const track of BUILTIN_AUDIO_TRACKS) {
      expect(Object.keys(track).sort()).toEqual([
        "builtin",
        "id",
        "loop",
        "name",
        "parentId",
        "volume"
      ]);
    }
  });

  it("names a seeded bus for every fallback channel, and each one really exists", () => {
    for (const [channel, id] of Object.entries(DEFAULT_AUDIO_TRACK_ID)) {
      expect(
        BUILTIN_AUDIO_TRACKS.find((entry) => entry.id === id),
        channel
      ).toBeDefined();
      expect(id, channel).toBe(channel);
    }
  });
});

describe("normalizeAudioTrackChannel", () => {
  it("keeps the three the engine has", () => {
    expect(normalizeAudioTrackChannel("bgm")).toBe("bgm");
    expect(normalizeAudioTrackChannel("voice")).toBe("voice");
    expect(normalizeAudioTrackChannel("sound")).toBe("sound");
  });

  it("lands anything else on the sound bus", () => {
    expect(normalizeAudioTrackChannel("ambience")).toBe("sound");
    expect(normalizeAudioTrackChannel(undefined)).toBe("sound");
    expect(normalizeAudioTrackChannel(3)).toBe("sound");
  });
});

describe("normalizeProjectAudioTrack", () => {
  it("drops an entry nothing can point at", () => {
    expect(normalizeProjectAudioTrack({ name: "Ambience" })).toBeNull();
    expect(normalizeProjectAudioTrack({ id: "   ", name: "Ambience" })).toBeNull();
    expect(normalizeProjectAudioTrack(null)).toBeNull();
    expect(normalizeProjectAudioTrack(["ambience"])).toBeNull();
    expect(normalizeProjectAudioTrack("ambience")).toBeNull();
  });

  /** `Channel.setVolume` clamps 0..1, so a bus attenuates and never boosts. */
  it("clamps volume into 0..1 rather than offering headroom the runtime drops", () => {
    expect(normalizeProjectAudioTrack({ id: "a", volume: -3 })!.volume).toBe(0);
    expect(normalizeProjectAudioTrack({ id: "a", volume: 1.5 })!.volume).toBe(1);
    expect(normalizeProjectAudioTrack({ id: "a", volume: 0.4 })!.volume).toBe(0.4);
  });

  it("falls back rather than storing a volume that is not a number", () => {
    expect(normalizeProjectAudioTrack({ id: "a", volume: Number.NaN })!.volume).toBe(1);
    expect(normalizeProjectAudioTrack({ id: "a", volume: Number.POSITIVE_INFINITY })!.volume).toBe(
      1
    );
    expect(normalizeProjectAudioTrack({ id: "a", volume: "loud" })!.volume).toBe(1);
  });

  it("keeps no fade fields at all", () => {
    const track = normalizeProjectAudioTrack({ id: "a", fadeInMs: 800, fadeOutMs: 800 })!;
    expect("fadeInMs" in track).toBe(false);
    expect("fadeOutMs" in track).toBe(false);
  });

  it("trims the id and the name, and names an unnamed track after its id", () => {
    const track = normalizeProjectAudioTrack({ id: "  ambience ", name: "  Ambience " })!;
    expect(track.id).toBe("ambience");
    expect(track.name).toBe("Ambience");
    expect(normalizeProjectAudioTrack({ id: "ambience" })!.name).toBe("ambience");
  });

  it("trims the parent, and refuses a track that names itself as its own parent", () => {
    expect(normalizeProjectAudioTrack({ id: "a", parentId: " voice " })!.parentId).toBe("voice");
    expect(normalizeProjectAudioTrack({ id: "a", parentId: "a" })!.parentId).toBeNull();
    expect(normalizeProjectAudioTrack({ id: "a", parentId: "" })!.parentId).toBeNull();
    expect(normalizeProjectAudioTrack({ id: "a", parentId: 7 })!.parentId).toBeNull();
  });

  it("marks the seeded three and only the seeded three", () => {
    expect(normalizeProjectAudioTrack({ id: AUDIO_TRACK_ID_BGM })!.builtin).toBe(true);
    expect("builtin" in normalizeProjectAudioTrack({ id: "ambience", builtin: true })!).toBe(false);
  });

  it("takes a seeded bus's own defaults for fields the stored entry omits", () => {
    expect(normalizeProjectAudioTrack({ id: AUDIO_TRACK_ID_BGM })).toEqual(BUILTIN_AUDIO_TRACKS[0]);
  });

  /** They are ordinary tracks apart from being undeletable: renameable, re-parentable, adjustable. */
  it("lets a seeded bus be renamed, re-parented and re-tuned", () => {
    const track = normalizeProjectAudioTrack({
      id: AUDIO_TRACK_ID_BGM,
      name: "Score",
      parentId: "submix",
      volume: 0.6,
      loop: false
    })!;
    expect(track).toEqual({
      id: AUDIO_TRACK_ID_BGM,
      name: "Score",
      parentId: "submix",
      volume: 0.6,
      loop: false,
      builtin: true
    });
  });
});

describe("normalizeProjectAudioTracks", () => {
  it("seeds all three from nothing at all", () => {
    for (const input of [undefined, null, [], {}, "tracks"]) {
      expect(normalizeProjectAudioTracks(input)).toEqual([...BUILTIN_AUDIO_TRACKS]);
    }
  });

  it("puts a missing seed back, in front, without disturbing what is there", () => {
    const tracks = normalizeProjectAudioTracks([
      custom({ id: "ambience", name: "Ambience" }),
      { id: AUDIO_TRACK_ID_VOICE }
    ]);
    expect(ids(tracks)).toEqual([
      AUDIO_TRACK_ID_BGM,
      AUDIO_TRACK_ID_SOUND,
      "ambience",
      AUDIO_TRACK_ID_VOICE
    ]);
  });

  it("preserves the order the author arranged the tracks in", () => {
    const tracks = normalizeProjectAudioTracks([
      custom({ id: "ui" }),
      { id: AUDIO_TRACK_ID_BGM },
      custom({ id: "ambience" }),
      { id: AUDIO_TRACK_ID_SOUND },
      { id: AUDIO_TRACK_ID_VOICE },
      custom({ id: "stinger" })
    ]);
    expect(ids(tracks)).toEqual([
      "ui",
      AUDIO_TRACK_ID_BGM,
      "ambience",
      AUDIO_TRACK_ID_SOUND,
      AUDIO_TRACK_ID_VOICE,
      "stinger"
    ]);
  });

  it("keeps a stored seed's edits rather than resetting it to the seed", () => {
    const tracks = normalizeProjectAudioTracks([
      { id: AUDIO_TRACK_ID_BGM, name: "Score", volume: 0.5, loop: false }
    ]);
    expect(tracks.find((track) => track.id === AUDIO_TRACK_ID_BGM)).toMatchObject({
      name: "Score",
      volume: 0.5,
      loop: false,
      builtin: true
    });
  });

  it("keeps the first of a duplicated id", () => {
    const tracks = normalizeProjectAudioTracks([
      custom({ id: "ambience", name: "First" }),
      custom({ id: "ambience", name: "Second" })
    ]);
    expect(tracks.filter((track) => track.id === "ambience")).toEqual([
      expect.objectContaining({ name: "First" })
    ]);
  });

  it("drops the entries that have no id and keeps the rest", () => {
    const tracks = normalizeProjectAudioTracks([
      { name: "nameless" },
      null,
      7,
      custom({ id: "ui" })
    ]);
    expect(ids(tracks)).toEqual([
      AUDIO_TRACK_ID_BGM,
      AUDIO_TRACK_ID_SOUND,
      AUDIO_TRACK_ID_VOICE,
      "ui"
    ]);
  });

  it("does not hand back the frozen seed objects, so a mutation cannot poison the next project", () => {
    const tracks = normalizeProjectAudioTracks([]);
    tracks[0].name = "Score";
    expect(BUILTIN_AUDIO_TRACKS[0].name).toBe("Music");
    expect(normalizeProjectAudioTracks([])[0].name).toBe("Music");
  });

  it("keeps a parent that really is there", () => {
    const tracks = normalizeProjectAudioTracks([
      custom({ id: "alice", parentId: AUDIO_TRACK_ID_VOICE })
    ]);
    expect(tracks.find((track) => track.id === "alice")!.parentId).toBe(AUDIO_TRACK_ID_VOICE);
  });

  it("re-roots a track whose parent is not in the document", () => {
    const tracks = normalizeProjectAudioTracks([custom({ id: "alice", parentId: "deleted-bus" })]);
    expect(tracks.find((track) => track.id === "alice")!.parentId).toBeNull();
  });
});

describe("a bad tree degrades rather than throwing", () => {
  const parents = (tracks: readonly ProjectAudioTrack[]): Record<string, string | null> =>
    Object.fromEntries(tracks.map((track) => [track.id, track.parentId]));

  it("cuts a self-parent loose", () => {
    const tracks = normalizeProjectAudioTracks([{ id: "a", parentId: "a" }]);
    expect(parents(tracks).a).toBeNull();
  });

  it("breaks a mutual cycle and leaves the pair as a chain", () => {
    const tracks = normalizeProjectAudioTracks([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" }
    ]);
    const result = parents(tracks);
    expect([result.a, result.b].filter((value) => value === null)).toHaveLength(1);
    expect(resolveAudioTrackChain(tracks, "a").length).toBeLessThanOrEqual(2);
  });

  it("breaks a longer ring without dropping any of its members", () => {
    const tracks = normalizeProjectAudioTracks([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "c" },
      { id: "c", parentId: "a" }
    ]);
    expect(ids(tracks)).toContain("c");
    expect(Object.values(parents(tracks)).filter((value) => value === null)).toHaveLength(4);
    // The proof the ring is gone: every member reaches master in a bounded walk.
    for (const id of ["a", "b", "c"]) {
      expect(resolveAudioTrackChain(tracks, id).length, id).toBeLessThanOrEqual(3);
    }
  });

  it("never throws, whatever the document says", () => {
    expect(() =>
      normalizeProjectAudioTracks([
        { id: "a", parentId: "b" },
        { id: "b", parentId: "a" },
        { id: "c", parentId: "c" },
        { id: "d", parentId: "nope" }
      ])
    ).not.toThrow();
  });

  /**
   * The first track past the cap is hoisted to the root and everything under it comes along,
   * because it is still that track's child - so an over-deep mixer is re-rooted rather than
   * shredded into loose tracks, and every remaining chain is inside the cap.
   */
  it("hoists the first track past the depth cap, and its subtree follows it up", () => {
    const chain = Array.from({ length: AUDIO_TRACK_MAX_DEPTH + 3 }, (_, index) => ({
      id: `n${index}`,
      parentId: index === 0 ? null : `n${index - 1}`
    }));
    const tracks = normalizeProjectAudioTracks(chain);
    const byId = parents(tracks);

    // n0..n8 is exactly the cap (eight ancestors); n9 is the first one over it.
    expect(byId[`n${AUDIO_TRACK_MAX_DEPTH}`]).toBe(`n${AUDIO_TRACK_MAX_DEPTH - 1}`);
    expect(byId[`n${AUDIO_TRACK_MAX_DEPTH + 1}`]).toBeNull();
    expect(byId[`n${AUDIO_TRACK_MAX_DEPTH + 2}`]).toBe(`n${AUDIO_TRACK_MAX_DEPTH + 1}`);
    for (const track of tracks) {
      expect(resolveAudioTrackChain(tracks, track.id).length, track.id).toBeLessThanOrEqual(
        AUDIO_TRACK_MAX_DEPTH + 1
      );
    }
  });

  it("still guarantees the three seeds when the rest of the document is a ring", () => {
    const tracks = normalizeProjectAudioTracks([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" }
    ]);
    for (const seed of BUILTIN_AUDIO_TRACKS) {
      expect(
        tracks.find((track) => track.id === seed.id),
        seed.id
      ).toBeDefined();
    }
  });
});

describe("the tree helpers", () => {
  const tracks = normalizeProjectAudioTracks([
    custom({ id: "alice", parentId: AUDIO_TRACK_ID_VOICE }),
    custom({ id: "alice-whisper", parentId: "alice" }),
    custom({ id: "bob", parentId: AUDIO_TRACK_ID_VOICE })
  ]);

  it("lists the direct children of a bus, and of master", () => {
    expect(ids(audioTrackChildren(tracks, AUDIO_TRACK_ID_VOICE))).toEqual(["alice", "bob"]);
    expect(ids(audioTrackChildren(tracks, null))).toEqual([
      AUDIO_TRACK_ID_BGM,
      AUDIO_TRACK_ID_SOUND,
      AUDIO_TRACK_ID_VOICE
    ]);
  });

  it("collects a whole subtree, excluding the root of it", () => {
    expect([...audioTrackDescendantIds(tracks, AUDIO_TRACK_ID_VOICE)].sort()).toEqual([
      "alice",
      "alice-whisper",
      "bob"
    ]);
    expect([...audioTrackDescendantIds(tracks, "alice")]).toEqual(["alice-whisper"]);
    expect([...audioTrackDescendantIds(tracks, "bob")]).toEqual([]);
  });

  it("flattens parents immediately before their children, with a depth per row", () => {
    expect(flattenAudioTrackTree(tracks).map((row) => [row.track.id, row.depth])).toEqual([
      [AUDIO_TRACK_ID_BGM, 0],
      [AUDIO_TRACK_ID_SOUND, 0],
      [AUDIO_TRACK_ID_VOICE, 0],
      ["alice", 1],
      ["alice-whisper", 2],
      ["bob", 1]
    ]);
  });

  it("still emits a row for a track the walk cannot reach", () => {
    const orphan = [...BUILTIN_AUDIO_TRACKS, custom({ id: "lost", parentId: "gone" })];
    expect(flattenAudioTrackTree(orphan).map((row) => row.track.id)).toContain("lost");
  });
});

describe("the document", () => {
  it("seeds at the current schema version, with meta only when a timestamp is given", () => {
    const seeded = createSeededAudioTrackDocument("2026-08-01T00:00:00.000Z");
    expect(seeded.schemaVersion).toBe(AUDIO_TRACK_SCHEMA_VERSION);
    expect(seeded.tracks).toEqual([...BUILTIN_AUDIO_TRACKS]);
    expect(seeded.meta).toEqual({
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });
    expect("meta" in createSeededAudioTrackDocument()).toBe(false);
  });

  it("migrates an empty or unrecognised root to the seeded document", () => {
    expect(migrateProjectAudioTrackDocument({})).toEqual(createSeededAudioTrackDocument());
    expect(migrateProjectAudioTrackDocument(null)).toEqual(createSeededAudioTrackDocument());
    expect(migrateProjectAudioTrackDocument({ tracks: {} })).toEqual(
      createSeededAudioTrackDocument()
    );
  });

  it("carries meta through and drops a meta that is not an object", () => {
    expect(migrateProjectAudioTrackDocument({ meta: { createdAt: "x" } }).meta).toEqual({
      createdAt: "x"
    });
    expect("meta" in migrateProjectAudioTrackDocument({ meta: "x" })).toBe(false);
  });

  /** The canonical encoder refuses `undefined` by name; `parentId: null` is a real value, not a hole. */
  it("never writes an explicit undefined", () => {
    const document = migrateProjectAudioTrackDocument({
      schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
      tracks: [custom({ id: "ui" })]
    });
    expect(
      document.tracks.every((track) => Object.values(track).every((value) => value !== undefined))
    ).toBe(true);
  });
});

describe("migrating a v1 document", () => {
  const v1 = (tracks: unknown[]): unknown => ({ schemaVersion: 1, tracks });

  it("renames the v1 seeds onto the engine's channel names, keeping the author's edits", () => {
    const document = migrateProjectAudioTrackDocument(
      v1([
        {
          id: "music",
          name: "Score",
          channel: "bgm",
          gain: 0.8,
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
        }
      ])
    );

    expect(ids(document.tracks)).toEqual([
      AUDIO_TRACK_ID_BGM,
      AUDIO_TRACK_ID_SOUND,
      AUDIO_TRACK_ID_VOICE
    ]);
    expect(document.tracks[0]).toEqual({
      id: AUDIO_TRACK_ID_BGM,
      name: "Score",
      parentId: null,
      volume: 0.8,
      loop: true,
      builtin: true
    });
    expect(document.schemaVersion).toBe(AUDIO_TRACK_SCHEMA_VERSION);
  });

  it("turns a custom track's channel into its parent bus", () => {
    const document = migrateProjectAudioTrackDocument(
      v1([
        { id: "ambience", name: "Ambience", channel: "bgm", gain: 0.5, fadeInMs: 1500, loop: true }
      ])
    );

    expect(document.tracks.find((track) => track.id === "ambience")).toEqual({
      id: "ambience",
      name: "Ambience",
      parentId: AUDIO_TRACK_ID_BGM,
      volume: 0.5,
      loop: true
    });
  });

  /** v1 allowed a gain up to 2; the runtime clamps at 1, so the migration makes that visible. */
  it("clamps a v1 gain above one into 0..1", () => {
    const document = migrateProjectAudioTrackDocument(
      v1([
        {
          id: "loud",
          name: "Loud",
          channel: "sound",
          gain: 2,
          fadeInMs: 0,
          fadeOutMs: 0,
          loop: false
        },
        {
          id: "quieter",
          name: "Quieter",
          channel: "sound",
          gain: 1.25,
          fadeInMs: 0,
          fadeOutMs: 0,
          loop: false
        }
      ])
    );

    expect(document.tracks.find((track) => track.id === "loud")!.volume).toBe(1);
    expect(document.tracks.find((track) => track.id === "quieter")!.volume).toBe(1);
  });

  it("drops both fades", () => {
    const document = migrateProjectAudioTrackDocument(
      v1([
        { id: "ambience", channel: "bgm", gain: 1, fadeInMs: 1500, fadeOutMs: 2500, loop: false }
      ])
    );
    const track = document.tracks.find((entry) => entry.id === "ambience")!;

    expect("fadeInMs" in track).toBe(false);
    expect("fadeOutMs" in track).toBe(false);
    expect(JSON.stringify(document)).not.toContain("fade");
  });

  /** Renaming `music` onto an author's own `bgm` would lose work the alias cannot bring back. */
  it("leaves a v1 seed alone when its new id is already taken", () => {
    const document = migrateProjectAudioTrackDocument(
      v1([
        { id: "bgm", name: "Mine", channel: "sound", gain: 1, loop: false },
        { id: "music", name: "Score", channel: "bgm", gain: 0.5, loop: true }
      ])
    );

    expect(document.tracks.find((track) => track.id === "bgm")).toMatchObject({
      name: "Mine",
      builtin: true
    });
    expect(document.tracks.find((track) => track.id === "music")).toMatchObject({
      name: "Score",
      parentId: AUDIO_TRACK_ID_BGM,
      volume: 0.5
    });
  });

  it("does not re-migrate a v2 document", () => {
    const already = migrateProjectAudioTrackDocument({
      schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
      tracks: [custom({ id: "alice", parentId: AUDIO_TRACK_ID_VOICE, volume: 0.7 })]
    });
    expect(already.tracks.find((track) => track.id === "alice")).toMatchObject({
      parentId: AUDIO_TRACK_ID_VOICE,
      volume: 0.7
    });
  });

  /** A version-less file is v1 - the field was written from the start, but a hand-edit can lose it. */
  it("treats a document with no schemaVersion as v1", () => {
    const document = migrateProjectAudioTrackDocument({
      tracks: [{ id: "ambience", channel: "voice", gain: 0.25 }]
    });
    expect(document.tracks.find((track) => track.id === "ambience")).toMatchObject({
      parentId: AUDIO_TRACK_ID_VOICE,
      volume: 0.25
    });
  });
});

describe("resolveAudioTrack", () => {
  const tracks = normalizeProjectAudioTracks([
    custom({ id: "ambience", parentId: AUDIO_TRACK_ID_BGM })
  ]);

  it("returns the track a live reference names", () => {
    expect(resolveAudioTrack(tracks, "ambience").id).toBe("ambience");
    expect(resolveAudioTrack(tracks, "  ambience  ").id).toBe("ambience");
  });

  it("falls back to the seeded bus for the caller's channel when the id is absent", () => {
    expect(resolveAudioTrack(tracks, undefined, "bgm").id).toBe(AUDIO_TRACK_ID_BGM);
    expect(resolveAudioTrack(tracks, null, "voice").id).toBe(AUDIO_TRACK_ID_VOICE);
    expect(resolveAudioTrack(tracks, "", "sound").id).toBe(AUDIO_TRACK_ID_SOUND);
  });

  /** References written under v1 are spread across documents this module cannot rewrite. */
  it("answers a v1 seed id with the bus it was renamed to", () => {
    expect(resolveAudioTrack(tracks, "music").id).toBe(AUDIO_TRACK_ID_BGM);
    expect(resolveAudioTrack(tracks, "sfx").id).toBe(AUDIO_TRACK_ID_SOUND);
  });

  it("prefers a live track over the legacy alias that shares its name", () => {
    const withOwn = normalizeProjectAudioTracks([custom({ id: "music", name: "Mine" })]);
    expect(resolveAudioTrack(withOwn, "music").name).toBe("Mine");
  });

  /** A deleted track must not silently mute the rows that still point at it. */
  it("falls back the same way for an id nothing answers to", () => {
    expect(resolveAudioTrack(tracks, "deleted-track", "bgm").id).toBe(AUDIO_TRACK_ID_BGM);
  });

  it("treats an unqualified caller as the sound bus", () => {
    expect(resolveAudioTrack(tracks, undefined).id).toBe(AUDIO_TRACK_ID_SOUND);
  });

  it("answers even from a list that never went through the normalizer", () => {
    expect(resolveAudioTrack([], "anything", "bgm")).toEqual(BUILTIN_AUDIO_TRACKS[0]);
  });
});

describe("the bus chain", () => {
  const tracks = normalizeProjectAudioTracks([
    { id: AUDIO_TRACK_ID_VOICE, volume: 0.8 },
    custom({ id: "alice", parentId: AUDIO_TRACK_ID_VOICE, volume: 0.5 }),
    custom({ id: "whisper", parentId: "alice", volume: 0.5 })
  ]);

  it("runs from the clip's own bus up to master", () => {
    expect(ids(resolveAudioTrackChain(tracks, "whisper"))).toEqual([
      "whisper",
      "alice",
      AUDIO_TRACK_ID_VOICE
    ]);
    expect(ids(resolveAudioTrackChain(tracks, AUDIO_TRACK_ID_BGM))).toEqual([AUDIO_TRACK_ID_BGM]);
  });

  it("multiplies every bus between the clip and master", () => {
    expect(resolveAudioTrackBusGain(tracks, "whisper")).toBe(0.2);
    expect(resolveAudioTrackBusGain(tracks, "alice")).toBe(0.4);
    expect(resolveAudioTrackBusGain(tracks, AUDIO_TRACK_ID_BGM)).toBe(1);
  });

  it("resolves a dangling id the same way the rest of the module does", () => {
    expect(ids(resolveAudioTrackChain(tracks, "gone", "voice"))).toEqual([AUDIO_TRACK_ID_VOICE]);
  });
});

describe("resolveAudioTrackPlayback", () => {
  const [bgm] = BUILTIN_AUDIO_TRACKS;

  it("routes to the track's own bus and takes its loop default", () => {
    expect(resolveAudioTrackPlayback(bgm)).toEqual({
      busId: AUDIO_TRACK_ID_BGM,
      volume: 1,
      loop: true
    });
  });

  /** The bus multiplies live, in the gain graph. Folding it in here would apply it twice. */
  it("passes the action's volume through without the bus gain", () => {
    const quiet = custom({ id: "quiet", volume: 0.5 });
    expect(resolveAudioTrackPlayback(quiet, { volume: 0.5 }).volume).toBe(0.5);
    expect(resolveAudioTrackPlayback(quiet).volume).toBe(1);
  });

  it("clamps the action volume into 0..1", () => {
    expect(resolveAudioTrackPlayback(bgm, { volume: -1 }).volume).toBe(0);
    expect(resolveAudioTrackPlayback(bgm, { volume: 4 }).volume).toBe(1);
  });

  it("lets an explicit false override a looping track", () => {
    expect(resolveAudioTrackPlayback(bgm, { loop: false }).loop).toBe(false);
    expect(resolveAudioTrackPlayback(bgm, { loop: null }).loop).toBe(true);
    expect(resolveAudioTrackPlayback(bgm, {}).loop).toBe(true);
  });

  it("ignores an override that is not a number", () => {
    expect(resolveAudioTrackPlayback(bgm, { volume: Number.NaN })).toEqual({
      busId: AUDIO_TRACK_ID_BGM,
      volume: 1,
      loop: true
    });
  });

  it("carries no fade of its own", () => {
    expect(Object.keys(resolveAudioTrackPlayback(bgm)).sort()).toEqual(["busId", "loop", "volume"]);
  });
});

describe("resolveMixedElementVolume", () => {
  const tracks = normalizeProjectAudioTracks([
    custom({ id: "alice", parentId: AUDIO_TRACK_ID_VOICE, volume: 0.5 })
  ]);

  it("is the authored volume when nothing attenuates it", () => {
    expect(resolveMixedElementVolume({ busId: AUDIO_TRACK_ID_SOUND, volume: 0.8 }, tracks)).toBe(
      0.8
    );
  });

  it("multiplies the whole bus chain in", () => {
    expect(resolveMixedElementVolume({ busId: "alice", volume: 1 }, tracks)).toBe(0.5);
  });

  /** The player's per-channel slider applies wherever that seeded bus sits in the chain. */
  it("applies the seeded bus's player slider to a clip nested below it", () => {
    expect(
      resolveMixedElementVolume({ busId: "alice", volume: 1 }, tracks, { voiceVolume: 0.5 })
    ).toBe(0.25);
    expect(resolveMixedElementVolume({ busId: "alice", volume: 1 }, tracks, { bgmVolume: 0 })).toBe(
      0.5
    );
  });

  it("obeys the master slider, so muting the game really mutes a host element", () => {
    expect(
      resolveMixedElementVolume({ busId: AUDIO_TRACK_ID_BGM, volume: 1 }, tracks, {
        globalVolume: 0
      })
    ).toBe(0);
  });

  it("treats an unreadable preference as unity rather than as silence", () => {
    expect(
      resolveMixedElementVolume({ busId: AUDIO_TRACK_ID_BGM, volume: 1 }, tracks, {
        globalVolume: null,
        bgmVolume: Number.NaN
      })
    ).toBe(1);
  });
});

describe("countAudioTrackReferences", () => {
  const known = [AUDIO_TRACK_ID_BGM, "ambience"];

  it("reports zero for every known track when nothing references them", () => {
    expect(countAudioTrackReferences([{ scenes: [] }], known)).toEqual({
      [AUDIO_TRACK_ID_BGM]: 0,
      ambience: 0
    });
  });

  it("counts both spellings, at any depth, across every root", () => {
    const story = {
      blocks: [{ audio: { audioTrackId: "ambience" } }, { audio: { trackId: "ambience" } }]
    };
    const graph = { nodes: { a: { params: { audioTrackId: AUDIO_TRACK_ID_BGM } } } };
    expect(countAudioTrackReferences([story, graph], known)).toEqual({
      [AUDIO_TRACK_ID_BGM]: 1,
      ambience: 2
    });
  });

  /** `trackId` is also what a story-motion timeline calls its rows; only known ids may count. */
  it("ignores a trackId that names something other than an audio track", () => {
    const timeline = { tracks: [{ id: "t1" }], selection: { trackId: "t1" } };
    expect(countAudioTrackReferences([timeline], known)).toEqual({
      [AUDIO_TRACK_ID_BGM]: 0,
      ambience: 0
    });
  });

  it("does not count an id that merely appears under some other key", () => {
    expect(countAudioTrackReferences([{ name: "ambience", id: "ambience" }], known).ambience).toBe(
      0
    );
  });

  it("terminates on a document that shares a sub-object with itself", () => {
    const shared: Record<string, unknown> = { audioTrackId: "ambience" };
    const root: Record<string, unknown> = { a: shared, b: shared };
    root.self = root;
    expect(countAudioTrackReferences([root], known).ambience).toBe(1);
  });
});
