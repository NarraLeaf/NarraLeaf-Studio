/**
 * Audio clip regions - the in and out points an author marks on an audio asset, and its gain.
 *
 * Both are authored in the asset manager's audio preview and stored on the asset record
 * (`Asset.extras.audioLoop` and `audioGain`, renderer-side types). This module is the *shared* half:
 * the shape as it travels in a game bundle, the one normalizer that turns a raw asset record into
 * it, and the two functions every playback path reads a clip through ({@link clipSoundConfig} and
 * {@link clipVolume}). Both the bundle assembler (main process) and the editor (renderer) reduce
 * through here, so a clip cannot mean one region or one level in the preview and another in the game.
 *
 * Why a region rather than a bag of markers: the question every consumer asks is "where does this
 * loop", which one pair answers and a marker list does not. Either end may stand alone while the
 * author is still deciding.
 *
 * Milliseconds here, seconds at the engine boundary - the engine's `Sound` config counts in seconds
 * like the rest of Web Audio, and every other time in Studio's editors is milliseconds. The
 * conversion happens once, where a `Sound` is constructed.
 * Comments in English per project convention.
 */

import type { ProjectAudioTrack } from "./audioTrack";

export type AudioClipRegion = {
    /** Offset from the start of the clip, in milliseconds. Where playback starts. */
    inMs?: number;
    /** Offset from the start of the clip, in milliseconds. Where playback stops, or where a loop turns around. */
    outMs?: number;
    /**
     * Offset from the start of the clip, in milliseconds. Where each repeat returns to.
     *
     * Absent means "return to {@link inMs}" - a plain loop, and exactly what every record written
     * before this field existed means. Set past the in point it describes the standard VN
     * **intro→loop**: `inMs..loopStartMs` plays once, then `loopStartMs..outMs` repeats forever.
     *
     * Constrained to `inMs <= loopStartMs < outMs`. A value outside that window is dropped rather
     * than clamped: clamping would invent a loop point the author never marked, while dropping
     * degrades to the plain loop the two other markers already describe.
     */
    loopStartMs?: number;
    /**
     * Playback gain in decibels, never above 0: the engine cannot raise a clip past its own level, so
     * balancing loudness means bringing the loud clips down. Absent is unity. Folded into a volume
     * only by {@link clipVolume}.
     */
    gainDb?: number;
};

/**
 * `extras.audioLoop` on an audio asset: the three markers and nothing else.
 *
 * A record written by an earlier build may also carry a `fileLength` the preview measured; nothing
 * reads it any more (see {@link clipSoundConfig} for how a region with no out point ends), and it
 * drops out the next time the markers are saved.
 */
export type StoredAudioClipRegion = Pick<AudioClipRegion, "inMs" | "outMs" | "loopStartMs">;

/**
 * `extras.audioGain` on an audio asset, absent at unity.
 *
 * An earlier build also stored the loudness a gain was aligned to; the gain alone is what plays, so
 * that key is ignored where it survives.
 */
export type StoredAudioGain = { db: number };

/** The quietest a gain can make a clip. Below this it is silence for every practical purpose. */
export const AUDIO_GAIN_MIN_DB = -60;

/**
 * Game audio payload: everything a running game needs to play a clip the way it was authored.
 *
 * Two tables, both keyed by what the surface that reads them already holds:
 *
 * - `clips` - the marked regions and gains, keyed by asset id. Only assets with markers or a gain
 *   appear, so a project whose author never opened the audio preview carries an empty table rather
 *   than one row per sound effect. Every path that plays a clip reads its entry through
 *   {@link clipSoundConfig} and {@link clipVolume}.
 * - `tracks` - the project's audio tracks, in author order. Always populated: a project with no
 *   `editor/audio-tracks.json` carries the three built-ins, which is what every reference falls
 *   back to anyway, so a consumer never has to decide what "no tracks" means.
 */
export type GameAudioBundle = {
    clips: Record<string, AudioClipRegion>;
    /**
     * Optional on the *type* only so a bundle serialized before tracks existed still parses; every
     * bundle this Studio assembles carries it. Read it through `resolveAudioTrack`, which falls back
     * to the built-ins, rather than branching on the absence here.
     */
    tracks?: ProjectAudioTrack[];
};

function finiteNonNegative(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return undefined;
    }
    return value;
}

/** A stored gain, clamped to what the engine can play; `undefined` for unity or anything unreadable. */
export function normalizeAudioGainDb(extras: unknown): number | undefined {
    const gain = extras && typeof extras === "object" ? (extras as { audioGain?: unknown }).audioGain : undefined;
    const db = gain && typeof gain === "object" ? (gain as { db?: unknown }).db : undefined;
    if (typeof db !== "number" || !Number.isFinite(db)) {
        return undefined;
    }
    const clamped = Math.max(AUDIO_GAIN_MIN_DB, Math.min(0, db));
    return clamped === 0 ? undefined : clamped;
}

/** Whether a region carries any of the three markers - as opposed to only a gain. */
export function hasClipMarkers(region: AudioClipRegion | null | undefined): boolean {
    return region?.inMs !== undefined || region?.outMs !== undefined || region?.loopStartMs !== undefined;
}

/**
 * Read how an asset's clip is played out of its `extras`: the marked region, tolerating the shape
 * that preceded it, and the gain.
 *
 * The short-lived cue-point model recorded exactly this - "a BGM's loop in/out points" - as a free
 * list, so the earliest two markers in time order are the in and the out. Reading them keeps records
 * written against the old shape from silently losing what the author marked. Never write `cuePoints`.
 *
 * Returns `null` rather than an empty object when nothing is marked and the gain is unity, so
 * callers can drop the asset from a table with a single check.
 */
export function normalizeAudioClipRegion(extras: unknown): AudioClipRegion | null {
    if (!extras || typeof extras !== "object") {
        return null;
    }
    const record = extras as { audioLoop?: unknown; cuePoints?: unknown };
    const loop = record.audioLoop && typeof record.audioLoop === "object"
        ? record.audioLoop as { inMs?: unknown; outMs?: unknown; loopStartMs?: unknown }
        : null;
    let inMs = finiteNonNegative(loop?.inMs);
    let outMs = finiteNonNegative(loop?.outMs);
    let loopStartMs = finiteNonNegative(loop?.loopStartMs);
    // The legacy list is only consulted when the current shape yielded no marker at all - a record
    // that carries a loop point was written by this model, and reading the old list underneath it
    // would resurrect points the author has since replaced.
    if (inMs === undefined && outMs === undefined && loopStartMs === undefined && Array.isArray(record.cuePoints)) {
        const legacy = record.cuePoints
            .map(entry => finiteNonNegative((entry as { timeMs?: unknown } | null)?.timeMs))
            .filter((time): time is number => time !== undefined)
            .sort((a, b) => a - b);
        inMs = legacy[0];
        outMs = legacy[1];
    }
    // An out point at or before the in point describes nothing playable. Dropping it here rather
    // than at each consumer means the editor and the game agree on which end survived.
    if (inMs !== undefined && outMs !== undefined && outMs <= inMs) {
        outMs = undefined;
    }
    // The loop point has to sit inside the playable window, `[inMs, outMs)` - an unmarked end
    // leaves that side open, because an absent in point is the head of the file and an absent out
    // point is its tail. Outside the window it is dropped rather than moved to the nearest edge:
    // a clamped point is a loop the author never marked, and silently playing one is worse than
    // falling back to the plain in→out loop the surviving markers already describe.
    if (loopStartMs !== undefined) {
        const belowIn = inMs !== undefined && loopStartMs < inMs;
        const atOrPastOut = outMs !== undefined && loopStartMs >= outMs;
        if (belowIn || atOrPastOut) {
            loopStartMs = undefined;
        }
    }
    const gainDb = normalizeAudioGainDb(extras);
    if (inMs === undefined && outMs === undefined && loopStartMs === undefined && gainDb === undefined) {
        return null;
    }
    return {
        ...(inMs !== undefined ? { inMs } : {}),
        ...(outMs !== undefined ? { outMs } : {}),
        ...(loopStartMs !== undefined ? { loopStartMs } : {}),
        ...(gainDb !== undefined ? { gainDb } : {}),
    };
}

/**
 * The end time a looping clip is given when its markers turn around at the end of the file: an in
 * or loop point, and no out point.
 *
 * The engine plays a loop region only with an end time beside it. Without one it takes the clip for
 * a whole-file loop and streams it through an element that restarts at 0:00, so "return to the loop
 * point at the end of the file" - what the preview plays and the seam view draws - reached the game
 * as "loop the whole file". With one it decodes the clip and hands the region to the buffer source,
 * which clamps a loop end past its buffer to the buffer's last sample (`actualLoopEnd =
 * min(loopEnd, duration)` in Web Audio's playback algorithm). The clip therefore turns around at the
 * end of the file exactly as the game decoded it: worked out from the markers alone, on every clip,
 * with no length measured or stored anywhere and nothing depending on the clip's preview having been
 * opened.
 *
 * A day, which is longer than any clip a game ships. Only a looping clip is given it: the engine sets
 * no stop timer for one, and a clip that plays once needs no end time to reach the end of its file.
 */
export const LOOP_TO_END_OF_FILE_SECONDS = 24 * 60 * 60;

/**
 * The volume a clip plays at: `volume` - the row's, the node's or the scene's own level - with the
 * clip's gain folded in.
 *
 * The one place a clip's gain becomes part of a volume, and every volume written for a clip goes
 * through it: the one its `Sound` starts at ({@link clipSoundConfig} calls this) and each one that
 * later replaces it - a `/vol` row, a Set Sound Volume node, the target of a fade-in. The engine
 * keeps one volume per sound and each of those writes it outright, so a gain folded in only at the
 * start would be gone after the first of them. What a caller keeps for a later write is the clip,
 * never a volume that already carries its gain, so each write folds the gain in exactly once.
 *
 * A gain never raises a clip: anything at or above 0 dB, or unreadable, is unity.
 */
export function clipVolume(region: AudioClipRegion | null | undefined, volume = 1): number {
    const db = region?.gainDb;
    if (db === undefined || !Number.isFinite(db) || db >= 0) {
        return volume;
    }
    return volume * Math.pow(10, Math.max(AUDIO_GAIN_MIN_DB, db) / 20);
}

/**
 * Everything a clip contributes to the `Sound` built to play it: the caller's volume with the clip's
 * gain folded in ({@link clipVolume}), and the marked region in the engine's seconds.
 *
 * The only way a clip's region reaches a `Sound` config, and it cannot be had without a volume - so
 * no call site can build a clip's `Sound` from its markers and leave its gain behind.
 *
 * `seek` is always present because zero is its default anyway, so there is no difference between
 * "starts at the beginning" and "unmarked". `endTime` is different: present means "stop/turn around
 * here", so it is the out point when there is one, the end of the file for a looping clip that
 * turns around past its head (see {@link LOOP_TO_END_OF_FILE_SECONDS}), and otherwise absent - a
 * whole-file loop keeps the streamed playback the engine gives one.
 *
 * `loopStart` is emitted only when it differs from `seek`. The engine's default is to return to
 * `seek`, so a loop point that equals the in point is the same playback either way - and leaving the
 * key off means a clip the author never gave a third marker produces byte-for-byte the config it
 * produced before this field existed.
 */
export function clipSoundConfig(
    region: AudioClipRegion | null | undefined,
    playback: { volume: number; loop: boolean },
): { volume: number; seek: number; endTime?: number; loopStart?: number } {
    const volume = clipVolume(region, playback.volume);
    const seek = (region?.inMs ?? 0) / 1000;
    const loopStart = region?.loopStartMs === undefined ? undefined : region.loopStartMs / 1000;
    const loopStartPart = loopStart !== undefined && loopStart !== seek ? { loopStart } : {};
    if (region?.outMs !== undefined) {
        return { volume, seek, endTime: region.outMs / 1000, ...loopStartPart };
    }
    // Where each repeat resumes: the loop point, else the in point. At the head of the file that is
    // a plain whole-file loop and needs no end time.
    if (playback.loop && (loopStart ?? seek) > 0) {
        return { volume, seek, endTime: LOOP_TO_END_OF_FILE_SECONDS, ...loopStartPart };
    }
    return { volume, seek, ...loopStartPart };
}
