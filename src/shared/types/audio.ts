/**
 * Audio clip regions - the in and out points an author marks on an audio asset.
 *
 * The points are authored in the asset manager's audio preview and stored on the asset record
 * (`Asset.extras.audioLoop`, a renderer-side type). This module is the *shared* half: the shape as
 * it travels in a game bundle, and the one normalizer that turns a raw asset record into it. Both
 * the bundle assembler (main process) and the editor (renderer) reduce through here, so a clip
 * cannot mean one region in the preview and another in the game.
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
     * Length of the file, in milliseconds, standing in for an out point the author did not mark.
     *
     * Carried only when a region needs it: an in or loop point with no out point. The engine keeps a
     * loop point only alongside an end time, and without one it streams a looping clip through an
     * element that restarts at 0:00 - so "loop back to the loop point at the end of the file", which
     * is what the preview plays and the seam view draws, reached the game as "loop the whole file".
     * The end of the file is the end time the author meant.
     */
    lengthMs?: number;
    /**
     * Playback gain in decibels, never above 0: the engine cannot raise a clip past its own level, so
     * balancing loudness means bringing the loud clips down. Absent is unity.
     */
    gainDb?: number;
};

/**
 * The file length a region was measured against, as the asset record stores it.
 *
 * Kept with the hash of the file it was measured on, because markers outlive the file: after the
 * file is replaced, a length from the old one would describe a loop end the new file does not have.
 * A length whose hash no longer matches is ignored, and the preview measures the new file again.
 */
export type AudioClipLength = { ms: number; hash: string };

/** `extras.audioLoop` on an audio asset: the three markers, plus the file length when it is needed. */
export type StoredAudioClipRegion = Pick<AudioClipRegion, "inMs" | "outMs" | "loopStartMs"> & {
    fileLength?: AudioClipLength;
};

/**
 * `extras.audioGain` on an audio asset.
 *
 * `targetLufs` is the loudness the gain was aligned to, when it came from aligning rather than from
 * a number typed in. It is what lets the next clip opened in the same project offer the same target,
 * so a project's clips balance against one another without a project setting to keep in step.
 */
export type StoredAudioGain = { db: number; targetLufs?: number };

/** The quietest a gain can make a clip. Below this it is silence for every practical purpose. */
export const AUDIO_GAIN_MIN_DB = -60;

/**
 * Game audio payload: everything a running game needs to play a clip the way it was authored.
 *
 * Two tables, both keyed by what the surface that reads them already holds:
 *
 * - `clips` - the marked regions, keyed by asset id. Only assets with a region appear, so a project
 *   whose author never opened the audio preview carries an empty table rather than one row per
 *   sound effect.
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
 * `fileHash` is the hash of the file the asset holds now. Only with it does a stored file length
 * reach the result, and only when it was measured on that same file (see {@link AudioClipLength}).
 * Callers that only draw the markers pass nothing.
 *
 * Returns `null` rather than an empty object when nothing is marked and the gain is unity, so
 * callers can drop the asset from a table with a single check.
 */
export function normalizeAudioClipRegion(extras: unknown, fileHash?: string): AudioClipRegion | null {
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
    // The file's end, standing in for the out point, only where the engine needs one and only when it
    // was measured on the file the asset holds now.
    let lengthMs: number | undefined;
    if (outMs === undefined && (inMs !== undefined || loopStartMs !== undefined) && fileHash) {
        const stored = (loop as { fileLength?: { ms?: unknown; hash?: unknown } } | null)?.fileLength;
        const ms = finiteNonNegative(stored?.ms);
        const lastMarker = Math.max(inMs ?? 0, loopStartMs ?? 0);
        if (stored?.hash === fileHash && ms !== undefined && ms > lastMarker) {
            lengthMs = ms;
        }
    }
    return {
        ...(inMs !== undefined ? { inMs } : {}),
        ...(outMs !== undefined ? { outMs } : {}),
        ...(loopStartMs !== undefined ? { loopStartMs } : {}),
        ...(lengthMs !== undefined ? { lengthMs } : {}),
        ...(gainDb !== undefined ? { gainDb } : {}),
    };
}

/**
 * A clip's gain as the linear factor a `Sound` volume is multiplied by: 1 when it has none.
 *
 * Multiplied into the volume at every place a clip starts *and* every place its volume is set again
 * afterwards, because the engine keeps one volume per sound: a `/vol` row or a Set Sound Volume node
 * writes that number outright, and a factor applied only at the start would be gone after the first.
 */
export function audioClipGain(region: AudioClipRegion | null | undefined): number {
    const db = region?.gainDb;
    return db === undefined || !Number.isFinite(db) ? 1 : Math.pow(10, Math.min(0, db) / 20);
}

/**
 * A region as the engine's `Sound` config wants it: seconds, and `endTime` omitted when unmarked.
 *
 * "Unmarked" means neither an out point nor a file length standing in for one: an in or loop point
 * with no out point ends at the end of the file, and says so, because the engine drops a loop point
 * that has no end time beside it (see {@link AudioClipRegion.lengthMs}). The gain is not part of this:
 * it multiplies the caller's own volume (see {@link audioClipGain}).
 *
 * `seek` is always present because zero is its default anyway, so there is no difference between
 * "starts at the beginning" and "unmarked". `endTime` is different: present means "stop/turn around
 * here", so an unmarked out point must leave the key off entirely.
 *
 * `loopStart` follows `endTime`'s rule and adds one of its own: it is emitted only when it differs
 * from `seek`. The engine's default is to return to `seek`, so a loop point that equals the in
 * point is the same playback either way - and leaving the key off means a clip the author never
 * gave a third marker produces byte-for-byte the config it produced before this field existed.
 */
export function audioClipRegionToSoundConfig(region: AudioClipRegion | null | undefined): {
    seek: number;
    endTime?: number;
    loopStart?: number;
} {
    const seek = (region?.inMs ?? 0) / 1000;
    const loopStart = region?.loopStartMs === undefined ? undefined : region.loopStartMs / 1000;
    const loopStartPart = loopStart !== undefined && loopStart !== seek ? { loopStart } : {};
    const endMs = region?.outMs ?? region?.lengthMs;
    if (endMs === undefined) {
        return { seek, ...loopStartPart };
    }
    return { seek, endTime: endMs / 1000, ...loopStartPart };
}
