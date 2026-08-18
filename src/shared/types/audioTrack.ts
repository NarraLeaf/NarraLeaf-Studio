/**
 * Audio tracks - the project's mixer, as a tree of buses.
 *
 * A track **is** a bus. It has a parent (another track, or the master output when `parentId` is
 * null) and its own live gain, and the engine builds one gain node per track at boot with each
 * child's gain connected to its parent's. So the effective level of a clip is a *graph*, not a
 * formula: the clip's own volume times every bus between it and the destination.
 *
 * That is the whole difference from the first round, where a track was an authoring-time preset -
 * a name, one of the engine's three fixed channels, and a multiplier folded into the clip at
 * compile time. The preset could not be adjusted by the player and could not express the case that
 * motivated the feature at all: **per-character voice volume**, i.e. `voice/alice -> voice ->
 * master`, which is two buses and one player slider that did not previously exist.
 *
 * Two things a track deliberately does NOT carry:
 *
 * - **A channel.** There is nothing left to point at; the track is the bus, and the three seeded
 *   tracks carry the ids the engine's three channels have always had.
 * - **Fades.** A fade is a property of the moment, not of a category - the same music fades in over
 *   3s at a chapter open, cuts hard on a jump-scare, and fades out over 8s at an ending. Every
 *   surface that plays or stops audio already has its own explicit fade field, so a fade on the
 *   track was pure default-filler that invented a default which had never existed. Absent fade
 *   means 0, exactly as it did before that field was added.
 *
 * Comments in English per project convention.
 */

/** Persisted document version for `editor/audio-tracks.json`. Independent of every other document. */
export const AUDIO_TRACK_SCHEMA_VERSION = 2 as const;

export type AudioTrackSchemaVersion = typeof AUDIO_TRACK_SCHEMA_VERSION;

export const AUDIO_TRACK_ID_BGM = "bgm";
export const AUDIO_TRACK_ID_SOUND = "sound";
export const AUDIO_TRACK_ID_VOICE = "voice";

/**
 * The ids of the three seeded, top-level buses.
 *
 * They are spelled the way the engine spells its channels (`SoundType`) because they *are* those
 * channels: existing content, existing saves and the player's four volume preferences all name
 * `bgm` / `sound` / `voice`, so seeding under any other id would strand every one of them.
 *
 * A caller passes one of these as its `fallbackChannel` when it knows the *shape* of what it is
 * playing but not which track - a `/bgm` row is music whether or not the track it names still
 * exists.
 */
export const AUDIO_TRACK_CHANNELS = [
  AUDIO_TRACK_ID_BGM,
  AUDIO_TRACK_ID_SOUND,
  AUDIO_TRACK_ID_VOICE
] as const;

export type AudioTrackChannel = (typeof AUDIO_TRACK_CHANNELS)[number];

/**
 * A bus attenuates; it never boosts.
 *
 * `Channel.setVolume` in `@narraleaf/sound` clamps to 0..1, so a stored 1.5 would be silently
 * truncated the moment it reached the runtime. Offering a range the runtime cannot honour is how an
 * author ends up tuning a number that does nothing, so the model clamps where the runtime does.
 */
export const AUDIO_TRACK_VOLUME_MIN = 0;
export const AUDIO_TRACK_VOLUME_MAX = 1;

/**
 * How far a track may sit below master.
 *
 * Not a musical limit - a gain node costs nothing - but a guard on the document: parent chains are
 * walked on every resolve, and a hand-edited or merge-mangled file must not be able to turn that
 * walk into an unbounded one. Eight is well past any mixer an author would build by hand
 * (`voice/party/alice/whisper` is four) and shallow enough that the walk is free.
 */
export const AUDIO_TRACK_MAX_DEPTH = 8;

export interface ProjectAudioTrack {
  /** Stable; referenced by story rows, scenes, blueprint nodes and widgets, and the engine bus id. */
  id: string;
  /** Author-facing. Renameable even for the seeded three - the id is what references hold. */
  name: string;
  /** The bus this one feeds into. `null` means it hangs directly off the master output. */
  parentId: string | null;
  /** 0..1. This bus's own gain - live, multiplied with every bus above it, never folded into clips. */
  volume: number;
  /** Default loop policy for clips played on this track. */
  loop: boolean;
  /** Set on the three seeded tracks. Derived from {@link isBuiltinAudioTrackId}, never authored. */
  builtin?: true;
}

/**
 * The three tracks every project has, seeded on first read and re-seeded if a document loses them.
 *
 * They are otherwise ordinary tracks - renameable, re-parentable, adjustable - and the only thing
 * that makes them special is that they cannot be deleted, because they are where an unresolvable
 * reference lands and what the player's four existing volume preferences alias onto.
 *
 * The loop defaults reproduce Studio's behaviour before tracks existed: music loops, sound effects
 * and voice fire once.
 */
export const BUILTIN_AUDIO_TRACKS: readonly ProjectAudioTrack[] = Object.freeze([
  Object.freeze({
    id: AUDIO_TRACK_ID_BGM,
    name: "Music",
    parentId: null,
    volume: 1,
    loop: true,
    builtin: true as const
  }),
  Object.freeze({
    id: AUDIO_TRACK_ID_SOUND,
    name: "SFX",
    parentId: null,
    volume: 1,
    loop: false,
    builtin: true as const
  }),
  Object.freeze({
    id: AUDIO_TRACK_ID_VOICE,
    name: "Voice",
    parentId: null,
    volume: 1,
    loop: false,
    builtin: true as const
  })
]) as readonly ProjectAudioTrack[];

/**
 * Which seeded bus a reference of a given shape falls back to. Identity, now that the seeded ids
 * *are* the channel names - kept as a map because the callers read it as "the default track for
 * this kind of play", which is a fact about the model rather than about string equality.
 */
export const DEFAULT_AUDIO_TRACK_ID: Readonly<Record<AudioTrackChannel, string>> = Object.freeze({
  bgm: AUDIO_TRACK_ID_BGM,
  sound: AUDIO_TRACK_ID_SOUND,
  voice: AUDIO_TRACK_ID_VOICE
});

/**
 * v1 seeded the three tracks under ids of their own (`music`, `sfx`, `voice`) rather than under the
 * engine's channel names. The document migration renames them, but the *references* stored in
 * stories, graphs and widgets are not rewritten - they are spread across documents this module
 * cannot see, and rewriting them would mean touching every one of them on load.
 *
 * So resolution knows the old spellings. A live track always wins: an author who creates a track
 * genuinely called `music` gets their own track, not the alias.
 */
export const LEGACY_AUDIO_TRACK_ID_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  music: AUDIO_TRACK_ID_BGM,
  sfx: AUDIO_TRACK_ID_SOUND
});

/** The persisted document. A plain array because author ordering is meaningful and a map loses it. */
export type ProjectAudioTrackDocument = {
  schemaVersion: AudioTrackSchemaVersion;
  tracks: ProjectAudioTrack[];
  meta?: {
    createdAt?: string;
    updatedAt?: string;
  };
};

/**
 * The field names a stored reference to a track uses.
 *
 * Declared here so the story rows, the blueprint node params and the widget props that carry a track
 * id agree on a spelling, and so the "how many things use this track" count has a single place to
 * learn about a new holder.
 */
export const AUDIO_TRACK_REFERENCE_FIELDS = ["audioTrackId", "trackId"] as const;

export function isBuiltinAudioTrackId(id: string): boolean {
  return BUILTIN_AUDIO_TRACKS.some((track) => track.id === id);
}

export function builtinAudioTrack(id: string): ProjectAudioTrack | undefined {
  return BUILTIN_AUDIO_TRACKS.find((track) => track.id === id);
}

export function normalizeAudioTrackChannel(value: unknown): AudioTrackChannel {
  return AUDIO_TRACK_CHANNELS.includes(value as AudioTrackChannel)
    ? (value as AudioTrackChannel)
    : AUDIO_TRACK_ID_SOUND;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** 0..1, clamped where the runtime clamps. */
export function normalizeAudioTrackVolume(value: unknown, fallback = 1): number {
  return clamp(finiteOr(value, fallback), AUDIO_TRACK_VOLUME_MIN, AUDIO_TRACK_VOLUME_MAX);
}

/**
 * One track, from whatever was on disk. `null` when there is no id to hold references by - an entry
 * nothing can point at is not a track, and keeping it would put an unaddressable row on the surface.
 *
 * Structural only: the parent is trimmed to a string or null here, but whether it *exists* and
 * whether it makes a cycle are questions about the whole list, answered by
 * {@link normalizeProjectAudioTracks}.
 */
export function normalizeProjectAudioTrack(raw: unknown): ProjectAudioTrack | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return null;
  }
  const builtin = builtinAudioTrack(id);
  const name =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : (builtin?.name ?? id);
  const parentRaw = typeof record.parentId === "string" ? record.parentId.trim() : "";

  return {
    id,
    name,
    parentId: parentRaw && parentRaw !== id ? parentRaw : null,
    volume: normalizeAudioTrackVolume(record.volume, builtin?.volume ?? 1),
    loop: typeof record.loop === "boolean" ? record.loop : (builtin?.loop ?? false),
    // Derived from the id and re-derived on every load, so a hand-written `builtin: true` on a
    // custom track cannot make it undeletable and a stripped one cannot make Music deletable.
    ...(builtin ? { builtin: true as const } : {})
  };
}

/**
 * The track list as the rest of Studio may assume it: every id unique, every `parentId` naming a
 * track that is really there, no cycles, nothing deeper than {@link AUDIO_TRACK_MAX_DEPTH}, and the
 * three seeded tracks present.
 *
 * **A bad tree degrades, it never throws.** A cycle - self, mutual, or a long ring - is broken by
 * re-parenting the offending track to the root, and an over-deep track is hoisted the same way. The
 * alternative is a project that cannot be opened because two rows of a JSON file point at each
 * other, which locks an author out of their own work over something they can fix in ten seconds
 * once they can see it.
 *
 * Order is the author's, except that a missing seeded track is prepended: the array order is sibling
 * order on the surface, and the tree itself is rebuilt from `parentId` rather than from position.
 */
export function normalizeProjectAudioTracks(raw: unknown): ProjectAudioTrack[] {
  const source = Array.isArray(raw) ? raw : [];
  const byId = new Map<string, ProjectAudioTrack>();
  const order: string[] = [];

  for (const entry of source) {
    const track = normalizeProjectAudioTrack(entry);
    if (!track || byId.has(track.id)) {
      // First wins. A duplicated id is one row on the surface either way, and taking the later
      // one would silently discard whichever of the two the author had been editing first.
      continue;
    }
    byId.set(track.id, track);
    order.push(track.id);
  }

  // Missing seeds go in front, in seed order, so a document that lost one comes back looking like
  // a fresh project rather than like a project with a stray track appended.
  const missing = BUILTIN_AUDIO_TRACKS.filter((seed) => !byId.has(seed.id));
  for (const seed of missing) {
    byId.set(seed.id, { ...seed });
  }
  const ids = [...missing.map((seed) => seed.id), ...order];

  // Unknown parent -> root. A reference to a track that was deleted (or never existed, in a
  // hand-written file) must not leave the track unreachable from master.
  for (const id of ids) {
    const track = byId.get(id)!;
    if (track.parentId !== null && !byId.has(track.parentId)) {
      track.parentId = null;
    }
  }

  // Cycles and depth, in one walk per track. `settled` is the visited set across the whole pass,
  // so a ring is paid for once rather than once per member.
  const settled = new Set<string>();
  for (const id of ids) {
    if (settled.has(id)) {
      continue;
    }
    const path: string[] = [];
    const onPath = new Set<string>();
    let cursor: string | null = id;
    while (cursor !== null && !settled.has(cursor)) {
      if (onPath.has(cursor)) {
        // The ring closes on a track already in this path, so that track is the one cut
        // loose. Everything else in the ring keeps the parent the author gave it: a
        // three-way cycle degrades into a three-deep chain rather than three loose tracks.
        byId.get(cursor)!.parentId = null;
        break;
      }
      onPath.add(cursor);
      path.push(cursor);
      cursor = byId.get(cursor)!.parentId;
    }
    for (const member of path) {
      settled.add(member);
    }
  }

  for (const id of ids) {
    if (audioTrackDepth(byId, id) > AUDIO_TRACK_MAX_DEPTH) {
      byId.get(id)!.parentId = null;
    }
  }

  return ids.map((entry) => byId.get(entry)!);
}

/** Ancestor count. Only called after cycles are broken, but bounded anyway so it cannot hang. */
function audioTrackDepth(byId: ReadonlyMap<string, ProjectAudioTrack>, id: string): number {
  let depth = 0;
  let cursor = byId.get(id)?.parentId ?? null;
  while (cursor !== null && depth <= AUDIO_TRACK_MAX_DEPTH + 1) {
    depth += 1;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return depth;
}

/** An absent or unreadable document is a project that has never had the Audio surface opened. */
export function createSeededAudioTrackDocument(now?: string): ProjectAudioTrackDocument {
  return {
    schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
    tracks: normalizeProjectAudioTracks([]),
    ...(now ? { meta: { createdAt: now, updatedAt: now } } : {})
  };
}

/**
 * v1 -> v2. A v1 track was `{id, name, channel, gain, fadeInMs, fadeOutMs, loop}`; a v2 track is a
 * bus.
 *
 * - `channel` becomes `parentId`, which is exactly what it meant: "the bus this lands on".
 * - `gain` becomes `volume`, clamped into 0..1 - a v1 document could store up to 2, and the runtime
 *   would have truncated it anyway, so the clamp makes visible what was already happening.
 * - the fades are dropped; see the module header.
 * - the v1 seeded ids (`music`, `sfx`) are renamed onto the engine's channel names, carrying the
 *   author's name, volume and loop with them. References to the old ids keep resolving through
 *   {@link LEGACY_AUDIO_TRACK_ID_ALIASES}. The rename is skipped if the document already contains a
 *   track under the new id, because dropping an author's own `bgm` track to make room would lose
 *   work that the alias cannot bring back.
 */
export function migrateProjectAudioTrackDocument(raw: unknown): ProjectAudioTrackDocument {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const meta =
    record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
      ? (record.meta as ProjectAudioTrackDocument["meta"])
      : undefined;
  const version = typeof record.schemaVersion === "number" ? record.schemaVersion : 1;
  const tracks = version < 2 ? migrateV1Tracks(record.tracks) : record.tracks;

  return {
    schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
    tracks: normalizeProjectAudioTracks(tracks),
    ...(meta ? { meta } : {})
  };
}

function migrateV1Tracks(raw: unknown): unknown[] {
  const source = Array.isArray(raw) ? raw : [];
  const presentIds = new Set(
    source
      .map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? (entry as Record<string, unknown>).id
          : null
      )
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim())
  );

  return source.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return entry;
    }
    const track = entry as Record<string, unknown>;
    const id = typeof track.id === "string" ? track.id.trim() : "";
    const alias = LEGACY_AUDIO_TRACK_ID_ALIASES[id];
    const renamed = alias && !presentIds.has(alias) ? alias : null;
    const channel = typeof track.channel === "string" ? track.channel.trim() : "";
    // A renamed seed IS the bus it used to point at, so it lands at the root rather than
    // becoming a child of itself.
    const parentId = renamed ? null : channel || null;

    return {
      id: renamed ?? id,
      name: track.name,
      parentId,
      volume: normalizeAudioTrackVolume(track.gain, 1),
      loop: track.loop
    };
  });
}

/**
 * The track a reference resolves to. Total by construction - there is always an answer, because a
 * play with no track is the ordinary case and a play whose track was deleted must still make a
 * sound rather than throw somewhere deep in a compiled story.
 *
 * `fallbackChannel` is the caller's own knowledge of what it is playing. It defaults to `sound`,
 * which is what an unqualified "play this clip" has always meant.
 */
export function resolveAudioTrack(
  tracks: readonly ProjectAudioTrack[],
  trackId: string | null | undefined,
  fallbackChannel: AudioTrackChannel = AUDIO_TRACK_ID_SOUND
): ProjectAudioTrack {
  const id = typeof trackId === "string" ? trackId.trim() : "";
  if (id) {
    const found = tracks.find((track) => track.id === id);
    if (found) {
      return found;
    }
    const alias = LEGACY_AUDIO_TRACK_ID_ALIASES[id];
    const aliased = alias ? tracks.find((track) => track.id === alias) : undefined;
    if (aliased) {
      return aliased;
    }
  }
  const fallbackId = DEFAULT_AUDIO_TRACK_ID[fallbackChannel];
  return (
    tracks.find((track) => track.id === fallbackId) ??
    // Reachable only for a caller holding a list that never went through
    // `normalizeProjectAudioTracks` (a test fixture, a partially-built preview). The seed is the
    // same value that list would have contained, so the answer is identical either way.
    builtinAudioTrack(fallbackId)!
  );
}

/**
 * Every bus a signal on `trackId` passes through, nearest first and master-most last.
 *
 * Bounded by {@link AUDIO_TRACK_MAX_DEPTH} independently of the normalizer, because this is called
 * with lists that a caller assembled by hand as well as with normalized ones.
 */
export function resolveAudioTrackChain(
  tracks: readonly ProjectAudioTrack[],
  trackId: string | null | undefined,
  fallbackChannel: AudioTrackChannel = AUDIO_TRACK_ID_SOUND
): ProjectAudioTrack[] {
  const chain: ProjectAudioTrack[] = [];
  const seen = new Set<string>();
  let cursor: ProjectAudioTrack | undefined = resolveAudioTrack(tracks, trackId, fallbackChannel);
  while (cursor && !seen.has(cursor.id) && chain.length <= AUDIO_TRACK_MAX_DEPTH) {
    seen.add(cursor.id);
    chain.push(cursor);
    const parentId: string | null = cursor.parentId;
    cursor = parentId === null ? undefined : tracks.find((track) => track.id === parentId);
  }
  return chain;
}

/** The product of every bus gain between a clip and the master output. 0..1. */
export function resolveAudioTrackBusGain(
  tracks: readonly ProjectAudioTrack[],
  trackId: string | null | undefined,
  fallbackChannel: AudioTrackChannel = AUDIO_TRACK_ID_SOUND
): number {
  return clamp01(
    resolveAudioTrackChain(tracks, trackId, fallbackChannel).reduce(
      (gain, track) => gain * clamp01(track.volume),
      1
    )
  );
}

/** Every track whose chain passes through `id`, `id` itself excluded. */
export function audioTrackDescendantIds(
  tracks: readonly ProjectAudioTrack[],
  id: string
): Set<string> {
  const descendants = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const track of tracks) {
      if (track.id === id || descendants.has(track.id) || track.parentId === null) {
        continue;
      }
      if (track.parentId === id || descendants.has(track.parentId)) {
        descendants.add(track.id);
        grew = true;
      }
    }
  }
  return descendants;
}

/** The tracks parented directly to `parentId`, in stored order. */
export function audioTrackChildren(
  tracks: readonly ProjectAudioTrack[],
  parentId: string | null
): ProjectAudioTrack[] {
  return tracks.filter((track) => track.parentId === parentId);
}

/**
 * The tree flattened for rendering: parents immediately before their children, depth-first, each
 * entry carrying how far below master it sits.
 *
 * Falls back to appending anything the walk did not reach, which a normalized list never has - but
 * this is also called straight from React state that a mutation is halfway through, and a row that
 * silently disappears is worse than a row that appears at the bottom.
 */
export function flattenAudioTrackTree(
  tracks: readonly ProjectAudioTrack[]
): { track: ProjectAudioTrack; depth: number }[] {
  const flat: { track: ProjectAudioTrack; depth: number }[] = [];
  const emitted = new Set<string>();

  const walk = (parentId: string | null, depth: number): void => {
    if (depth > AUDIO_TRACK_MAX_DEPTH) {
      return;
    }
    for (const track of tracks) {
      if (track.parentId !== parentId || emitted.has(track.id)) {
        continue;
      }
      emitted.add(track.id);
      flat.push({ track, depth });
      walk(track.id, depth + 1);
    }
  };
  walk(null, 0);

  for (const track of tracks) {
    if (!emitted.has(track.id)) {
      flat.push({ track, depth: 0 });
    }
  }
  return flat;
}

/**
 * What a play actually uses, after the track's defaults and the action's overrides are folded.
 *
 * Two survivors from v1, and they are the only two a *track* can contribute now:
 *
 * - `busId` - which bus the clip is routed to, i.e. the track's own id. It replaces `channel`,
 *   which named one of three fixed engine channels; the bus tree above it is the engine's business
 *   at boot, not the compiler's at compile time.
 * - `loop` - the track's default loop policy, still overridable per action.
 *
 * `volume` is here but is the *action's* number, passed through: the bus gain is applied live by
 * the gain graph, so pre-multiplying it into the clip (which is what v1 did) would both apply it
 * twice and freeze it at compile time, where no player slider can reach it.
 *
 * The fades are gone entirely rather than passed through, because the caller already holds its own
 * fade and a resolver that hands it straight back is a place for a default to be invented later.
 */
export type AudioTrackPlayback = {
  /** The engine bus this clip plays on - the track's id. */
  busId: string;
  /** 0..1 - the clip's authored volume, unmultiplied. */
  volume: number;
  loop: boolean;
};

export type AudioTrackPlaybackOverrides = {
  /** The action's own volume, 0..1 as authored. Absent means unity. */
  volume?: number | null;
  loop?: boolean | null;
};

export function resolveAudioTrackPlayback(
  track: ProjectAudioTrack,
  overrides: AudioTrackPlaybackOverrides = {}
): AudioTrackPlayback {
  const actionVolume =
    typeof overrides.volume === "number" && Number.isFinite(overrides.volume)
      ? overrides.volume
      : 1;

  return {
    busId: track.id,
    volume: clamp01(actionVolume),
    loop: typeof overrides.loop === "boolean" ? overrides.loop : track.loop
  };
}

/**
 * The player's four volume preferences, as the engine's `Preference` spells them.
 *
 * Partial and nullable because the only way to read them is off a live game, and a host asking
 * before one exists must get a number back rather than an exception - see
 * {@link resolveMixedElementVolume}.
 */
export type AudioMixPreferences = {
  globalVolume?: number | null;
  bgmVolume?: number | null;
  soundVolume?: number | null;
  voiceVolume?: number | null;
};

const CHANNEL_PREFERENCE_KEY: Readonly<Record<AudioTrackChannel, keyof AudioMixPreferences>> =
  Object.freeze({
    bgm: "bgmVolume",
    sound: "soundVolume",
    voice: "voiceVolume"
  });

function preferenceVolume(
  preferences: AudioMixPreferences,
  key: keyof AudioMixPreferences
): number {
  const value = preferences[key];
  // An unset preference is unity, not silence: a host that cannot reach the live game yet must
  // still play at the authored level rather than mute the clip until the game boots.
  return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 1;
}

/**
 * The volume a **host-owned** media element must be set to so it obeys the same mixer the engine's
 * own sounds do.
 *
 * A DOM `<video>` or `<audio>` the host created is on none of the engine's gain nodes, so the whole
 * product has to be computed here and written to `element.volume`. With a tree that means walking
 * the clip's bus chain rather than reading one channel: the clip's authored volume, times every bus
 * between it and master, times the player's slider for whichever seeded bus the chain passes
 * through, times the master slider.
 *
 * Get this wrong in the "just use the authored number" direction and muting the game leaves the clip
 * blaring - which is exactly the defect this exists to close.
 */
export function resolveMixedElementVolume(
  playback: Pick<AudioTrackPlayback, "busId" | "volume">,
  tracks: readonly ProjectAudioTrack[],
  preferences: AudioMixPreferences = {}
): number {
  const chain = resolveAudioTrackChain(tracks, playback.busId);
  const busGain = chain.reduce((gain, track) => {
    const sliderKey = CHANNEL_PREFERENCE_KEY[track.id as AudioTrackChannel];
    // The player's per-channel sliders are aliases onto the seeded buses, so they apply where
    // that bus sits in the chain - a `voice/alice` clip is governed by Voice Volume because its
    // chain runs through `voice`, without anything having to say so.
    const slider = sliderKey ? preferenceVolume(preferences, sliderKey) : 1;
    return gain * clamp01(track.volume) * slider;
  }, 1);

  return clamp01(
    clamp01(playback.volume) * busGain * preferenceVolume(preferences, "globalVolume")
  );
}

/**
 * How many stored references point at each track, across whatever documents the caller hands over.
 *
 * A structural sweep rather than a per-holder extractor, because the holders are spread across
 * story rows, blueprint params and widget props, and an extractor per holder would have to be
 * revisited by each of them. The sweep is safe because it only counts values that name a track in
 * `trackIds` - `trackId` is also the key a story-motion timeline uses for its own rows, and matching
 * against the known set is what keeps those from reporting as audio references.
 */
export function countAudioTrackReferences(
  roots: readonly unknown[],
  trackIds: readonly string[]
): Record<string, number> {
  const known = new Set(trackIds);
  const counts: Record<string, number> = {};
  for (const id of trackIds) {
    counts[id] = 0;
  }
  const seen = new Set<object>();

  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    // Documents are trees, but an in-memory one can hold a shared sub-object; without this a
    // cycle would hang the surface rather than report a number.
    if (seen.has(value as object)) {
      return;
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof child === "string" &&
        (AUDIO_TRACK_REFERENCE_FIELDS as readonly string[]).includes(key) &&
        known.has(child)
      ) {
        counts[child] += 1;
        continue;
      }
      walk(child);
    }
  };

  for (const root of roots) {
    walk(root);
  }
  return counts;
}
