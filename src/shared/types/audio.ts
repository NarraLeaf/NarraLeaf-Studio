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

export type AudioClipRegion = {
    /** Offset from the start of the clip, in milliseconds. Where playback starts, and where a loop returns to. */
    inMs?: number;
    /** Offset from the start of the clip, in milliseconds. Where playback stops, or where a loop turns around. */
    outMs?: number;
};

/**
 * Game audio payload: the marked regions of every audio asset that has any, keyed by asset id.
 *
 * Only assets with a region appear, so a project whose author never opened the audio preview
 * carries an empty table rather than one row per sound effect. Absent from the bundle entirely
 * when no asset has been marked.
 */
export type GameAudioBundle = {
    clips: Record<string, AudioClipRegion>;
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
        ? record.audioLoop as { inMs?: unknown; outMs?: unknown }
        : null;
    let inMs = finiteNonNegative(loop?.inMs);
    let outMs = finiteNonNegative(loop?.outMs);
    if (inMs === undefined && outMs === undefined && Array.isArray(record.cuePoints)) {
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
    if (inMs === undefined && outMs === undefined) {
        return null;
    }
    return {
        ...(inMs !== undefined ? { inMs } : {}),
        ...(outMs !== undefined ? { outMs } : {}),
    };
}

/**
 * A region as the engine's `Sound` config wants it: seconds, and `endTime` omitted when unmarked.
 *
 * `seek` is always present because zero is its default anyway, so there is no difference between
 * "starts at the beginning" and "unmarked". `endTime` is different: present means "stop/turn around
 * here", so an unmarked out point must leave the key off entirely.
 */
export function audioClipRegionToSoundConfig(region: AudioClipRegion | null | undefined): {
    seek: number;
    endTime?: number;
} {
    const seek = (region?.inMs ?? 0) / 1000;
    if (region?.outMs === undefined) {
        return { seek };
    }
    return { seek, endTime: region.outMs / 1000 };
}
