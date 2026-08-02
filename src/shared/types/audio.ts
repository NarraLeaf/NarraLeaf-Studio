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
};

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

/**
 * Read a region out of an asset's `extras`, tolerating the shape that preceded it.
 *
 * The short-lived cue-point model recorded exactly this - "a BGM's loop in/out points" - as a free
 * list, so the earliest two markers in time order are the in and the out. Reading them keeps records
 * written against the old shape from silently losing what the author marked. Never write `cuePoints`.
 *
 * Returns `null` rather than an empty object when nothing is marked, so callers can drop the asset
 * from a table with a single check.
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
    if (inMs === undefined && outMs === undefined && loopStartMs === undefined) {
        return null;
    }
    return {
        ...(inMs !== undefined ? { inMs } : {}),
        ...(outMs !== undefined ? { outMs } : {}),
        ...(loopStartMs !== undefined ? { loopStartMs } : {}),
    };
}

/**
 * A region as the engine's `Sound` config wants it: seconds, and `endTime` omitted when unmarked.
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
    if (region?.outMs === undefined) {
        return { seek, ...loopStartPart };
    }
    return { seek, endTime: region.outMs / 1000, ...loopStartPart };
}
