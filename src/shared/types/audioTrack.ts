/**
 * Audio tracks - the one project-level noun every audio-producing surface points at.
 *
 * Before this existed, "which mixer bus does this clip land on" was answered three different ways
 * that never met: the story compiler hard-coded it per operation, a blueprint `Play Sound` node had
 * its own `soundChannel` select reachable nowhere else, and a per-action `volume` silently
 * multiplied with the player's preference sliders with nothing in the UI saying so.
 *
 * A track collapses all of that into a row an author can see and edit: a name, the bus it lands on
 * (which is exactly the player-facing volume slider that governs it), the multiplier that used to be
 * invisible, and the fade/loop defaults a play on this track inherits.
 *
 * **What a track is NOT**: a runtime-adjustable bus. The engine has three gain buses and one master,
 * and those stay the player's knobs. A track is an *authoring-time mix preset* that resolves to
 * (bus, multiplier, defaults) at compile/play time - see {@link resolveAudioTrackPlayback}. Nothing
 * here needs an engine change, and adding "Ambience" costs one row instead of a convention every
 * author has to remember.
 *
 * Comments in English per project convention.
 */

/**
 * The engine's mixer buses, spelled the way the engine spells them (`SoundType`).
 *
 * These are also the player's preference sliders: `bgm` follows BGM Volume, `sound` follows Sound
 * Volume, `voice` follows Voice Volume, and all three follow the master. That one-to-one mapping is
 * the reason a track's channel is worth showing on its row.
 */
export const AUDIO_TRACK_CHANNELS = ["bgm", "voice", "sound"] as const;

export type AudioTrackChannel = (typeof AUDIO_TRACK_CHANNELS)[number];

/** Persisted document version for `editor/audio-tracks.json`. Independent of every other document. */
export const AUDIO_TRACK_SCHEMA_VERSION = 1 as const;

export type AudioTrackSchemaVersion = typeof AUDIO_TRACK_SCHEMA_VERSION;

/**
 * The multiplier ceiling. Two rather than one because the point of exposing the multiplier is to let
 * an author fix a quiet source, which needs headroom above unity; the *result* is still clamped to
 * 0..1 at resolve time, since that is all a gain node accepts.
 */
export const AUDIO_TRACK_GAIN_MIN = 0;
export const AUDIO_TRACK_GAIN_MAX = 2;

export interface ProjectAudioTrack {
    /** Stable; referenced by story rows, scenes, blueprint nodes and widgets. */
    id: string;
    /** Author-facing. Renameable even for the three built-ins - the id is what references hold. */
    name: string;
    /** Engine mixer bus == which player slider governs it. Fixed for the built-ins; see below. */
    channel: AudioTrackChannel;
    /** 0..{@link AUDIO_TRACK_GAIN_MAX}. The multiplier, made explicit and editable. */
    gain: number;
    /** Default fade for plays on this track, in milliseconds. */
    fadeInMs: number;
    /** Default fade for stops on this track, in milliseconds. */
    fadeOutMs: number;
    /** Default loop policy for plays on this track. */
    loop: boolean;
    /** Set on the three seeded tracks. Derived from {@link isBuiltinAudioTrackId}, never authored. */
    builtin?: boolean;
}

export const AUDIO_TRACK_ID_MUSIC = "music";
export const AUDIO_TRACK_ID_SFX = "sfx";
export const AUDIO_TRACK_ID_VOICE = "voice";

/**
 * The three tracks every project has, seeded on first read.
 *
 * One per bus, so that "no track chosen" always has somewhere honest to land, and so that a project
 * that never opens the Audio surface behaves exactly the way Studio behaved before tracks existed:
 * BGM fades over 800ms and loops, sound effects and voice fire dry and once.
 */
export const BUILTIN_AUDIO_TRACKS: readonly ProjectAudioTrack[] = Object.freeze([
    Object.freeze({
        id: AUDIO_TRACK_ID_MUSIC,
        name: "Music",
        channel: "bgm",
        gain: 1,
        fadeInMs: 800,
        fadeOutMs: 800,
        loop: true,
        builtin: true,
    }),
    Object.freeze({
        id: AUDIO_TRACK_ID_SFX,
        name: "SFX",
        channel: "sound",
        gain: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
        loop: false,
        builtin: true,
    }),
    Object.freeze({
        id: AUDIO_TRACK_ID_VOICE,
        name: "Voice",
        channel: "voice",
        gain: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
        loop: false,
        builtin: true,
    }),
]) as readonly ProjectAudioTrack[];

/**
 * Which built-in a channel falls back to.
 *
 * Read by {@link resolveAudioTrack} when a reference names a track that has been deleted or was
 * never set. The caller supplies the channel because it knows the *shape* of the thing it is
 * playing (a `/bgm` row is music whether or not its track still exists), which the dangling id
 * cannot tell it.
 */
export const DEFAULT_AUDIO_TRACK_ID: Readonly<Record<AudioTrackChannel, string>> = Object.freeze({
    bgm: AUDIO_TRACK_ID_MUSIC,
    sound: AUDIO_TRACK_ID_SFX,
    voice: AUDIO_TRACK_ID_VOICE,
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
 * Declared here so the story rows, the blueprint node params and the widget props that will hold one
 * agree on a spelling, and so the "how many things use this track" count on the Audio surface has a
 * single place to learn about a new holder.
 */
export const AUDIO_TRACK_REFERENCE_FIELDS = ["audioTrackId", "trackId"] as const;

export function isBuiltinAudioTrackId(id: string): boolean {
    return BUILTIN_AUDIO_TRACKS.some(track => track.id === id);
}

export function builtinAudioTrack(id: string): ProjectAudioTrack | undefined {
    return BUILTIN_AUDIO_TRACKS.find(track => track.id === id);
}

export function normalizeAudioTrackChannel(value: unknown): AudioTrackChannel {
    return AUDIO_TRACK_CHANNELS.includes(value as AudioTrackChannel)
        ? value as AudioTrackChannel
        : "sound";
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

/**
 * One track, from whatever was on disk. `null` when there is no id to hold references by - an entry
 * nothing can point at is not a track, and keeping it would put an unaddressable row on the surface.
 *
 * The built-in arm is what makes the three seeded tracks survive hand-editing: their channel is
 * forced back to the seed, because `DEFAULT_AUDIO_TRACK_ID` promises that `music` is where a bgm
 * play lands, and a `music` re-pointed at the voice bus would quietly break every `/bgm` row whose
 * own track had been deleted. Name, gain, fades and loop stay the author's.
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
    const name = typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : builtin?.name ?? id;

    return {
        id,
        name,
        channel: builtin ? builtin.channel : normalizeAudioTrackChannel(record.channel),
        gain: clamp(finiteOr(record.gain, builtin?.gain ?? 1), AUDIO_TRACK_GAIN_MIN, AUDIO_TRACK_GAIN_MAX),
        fadeInMs: Math.max(0, finiteOr(record.fadeInMs, builtin?.fadeInMs ?? 0)),
        fadeOutMs: Math.max(0, finiteOr(record.fadeOutMs, builtin?.fadeOutMs ?? 0)),
        loop: typeof record.loop === "boolean" ? record.loop : builtin?.loop ?? false,
        // Derived from the id and re-derived on every load, so a hand-written `builtin: true` on a
        // custom track cannot make it undeletable and a stripped one cannot make Music deletable.
        ...(builtin ? { builtin: true } : {}),
    };
}

/**
 * The track list as the rest of Studio may assume it: the three built-ins first and in seed order,
 * then everything the author added, in the order they arranged it.
 *
 * The built-ins lead rather than sort by name because they are the fallbacks - the row an author
 * looks for when they want to know what an untracked sound does is the first row. Their *stored*
 * form wins over the seed when there is one, which is how a rename or a re-tuned fade survives.
 */
export function normalizeProjectAudioTracks(raw: unknown): ProjectAudioTrack[] {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map<string, ProjectAudioTrack>();
    const customOrder: string[] = [];

    for (const entry of source) {
        const track = normalizeProjectAudioTrack(entry);
        if (!track || byId.has(track.id)) {
            // First wins. A duplicated id is one row on the surface either way, and taking the later
            // one would silently discard whichever of the two the author had been editing first.
            continue;
        }
        byId.set(track.id, track);
        if (!track.builtin) {
            customOrder.push(track.id);
        }
    }

    const builtins = BUILTIN_AUDIO_TRACKS.map(seed => byId.get(seed.id) ?? { ...seed });
    return [...builtins, ...customOrder.map(id => byId.get(id)!)];
}

/** An absent or unreadable document is a project that has never had the Audio surface opened. */
export function createSeededAudioTrackDocument(now?: string): ProjectAudioTrackDocument {
    return {
        schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
        tracks: normalizeProjectAudioTracks([]),
        ...(now ? { meta: { createdAt: now, updatedAt: now } } : {}),
    };
}

/** Load-time migration. v1 is the first version; anything newer is refused by the spec's `parse`. */
export function migrateProjectAudioTrackDocument(raw: unknown): ProjectAudioTrackDocument {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    const meta = record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
        ? record.meta as ProjectAudioTrackDocument["meta"]
        : undefined;
    return {
        schemaVersion: AUDIO_TRACK_SCHEMA_VERSION,
        tracks: normalizeProjectAudioTracks(record.tracks),
        ...(meta ? { meta } : {}),
    };
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
    fallbackChannel: AudioTrackChannel = "sound",
): ProjectAudioTrack {
    const id = typeof trackId === "string" ? trackId.trim() : "";
    if (id) {
        const found = tracks.find(track => track.id === id);
        if (found) {
            return found;
        }
    }
    const fallbackId = DEFAULT_AUDIO_TRACK_ID[fallbackChannel];
    return tracks.find(track => track.id === fallbackId)
        // Reachable only for a caller holding a list that never went through
        // `normalizeProjectAudioTracks` (a test fixture, a partially-built preview). The seed is the
        // same value that list would have contained, so the answer is identical either way.
        ?? builtinAudioTrack(fallbackId)!;
}

/** What a play/stop actually uses, after the track's defaults and the action's overrides are folded. */
export type AudioTrackPlayback = {
    channel: AudioTrackChannel;
    /** 0..1 - the gain a mixer node accepts, after the track multiplier. */
    volume: number;
    fadeInMs: number;
    fadeOutMs: number;
    loop: boolean;
};

export type AudioTrackPlaybackOverrides = {
    /** The action's own volume, 0..1 as authored. Absent means "whatever the track says", i.e. 1. */
    volume?: number | null;
    /** The action's own fade, applied to BOTH directions - an action carries one fade, a track two. */
    fadeMs?: number | null;
    loop?: boolean | null;
};

/**
 * The resolution formula, in one place.
 *
 * ```
 * type   = track.channel
 * volume = clamp01((action.volume ?? 1) * track.gain)
 * fadeIn  = action.fadeMs ?? track.fadeInMs
 * fadeOut = action.fadeMs ?? track.fadeOutMs
 * loop    = action.loop   ?? track.loop
 * ```
 *
 * The clamp is on the *product*, not on either factor: a 0.5 action volume on a 2.0 track is unity,
 * which is the whole reason the multiplier is worth exposing, and clamping the factors separately
 * would have thrown that away.
 */
export function resolveAudioTrackPlayback(
    track: ProjectAudioTrack,
    overrides: AudioTrackPlaybackOverrides = {},
): AudioTrackPlayback {
    const actionVolume = typeof overrides.volume === "number" && Number.isFinite(overrides.volume)
        ? overrides.volume
        : 1;
    const actionFade = typeof overrides.fadeMs === "number" && Number.isFinite(overrides.fadeMs)
        ? Math.max(0, overrides.fadeMs)
        : null;

    return {
        channel: track.channel,
        volume: clamp01(actionVolume * track.gain),
        fadeInMs: actionFade ?? track.fadeInMs,
        fadeOutMs: actionFade ?? track.fadeOutMs,
        loop: typeof overrides.loop === "boolean" ? overrides.loop : track.loop,
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

const CHANNEL_PREFERENCE_KEY: Readonly<Record<AudioTrackChannel, keyof AudioMixPreferences>> = Object.freeze({
    bgm: "bgmVolume",
    sound: "soundVolume",
    voice: "voiceVolume",
});

function preferenceVolume(preferences: AudioMixPreferences, key: keyof AudioMixPreferences): number {
    const value = preferences[key];
    // An unset preference is unity, not silence: a host that cannot reach the live game yet must
    // still play at the authored level rather than mute the clip until the game boots.
    return typeof value === "number" && Number.isFinite(value) ? clamp01(value) : 1;
}

/**
 * The volume a **host-owned** media element must be set to so it obeys the same mixer the engine's
 * own sounds do.
 *
 * The engine routes a `Sound` through master → per-channel gain → token volume, all multiplicative
 * (`AudioManager.setGlobalVolume` / `setGroupVolume`). A DOM `<video>` or `<audio>` the host created
 * is on none of those nodes, so the product has to be computed here and written to `element.volume`.
 * Get this wrong in the "just use the authored number" direction and muting the game leaves the clip
 * blaring - which is exactly the defect this exists to close.
 *
 * Takes the already-resolved playback (so the track's own gain is folded in by
 * {@link resolveAudioTrackPlayback} and not duplicated here) plus whatever the player's sliders
 * currently say.
 */
export function resolveMixedElementVolume(
    playback: Pick<AudioTrackPlayback, "channel" | "volume">,
    preferences: AudioMixPreferences = {},
): number {
    const channelVolume = preferenceVolume(preferences, CHANNEL_PREFERENCE_KEY[playback.channel]);
    const globalVolume = preferenceVolume(preferences, "globalVolume");
    return clamp01(clamp01(playback.volume) * channelVolume * globalVolume);
}

/**
 * How many stored references point at each track, across whatever documents the caller hands over.
 *
 * A structural sweep rather than a per-holder extractor, because the holders do not exist yet: the
 * story rows, blueprint params and widget props that will carry a track id land in later milestones,
 * and an extractor per holder would have to be revisited by each of them. The sweep is safe because
 * it only counts values that name a track in `trackIds` - `trackId` is also the key a story-motion
 * timeline uses for its own rows, and matching against the known set is what keeps those from
 * reporting as audio references.
 */
export function countAudioTrackReferences(
    roots: readonly unknown[],
    trackIds: readonly string[],
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
            if (typeof child === "string"
                && (AUDIO_TRACK_REFERENCE_FIELDS as readonly string[]).includes(key)
                && known.has(child)
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
