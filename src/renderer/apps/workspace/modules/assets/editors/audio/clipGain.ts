import {
    AUDIO_GAIN_MIN_DB,
    normalizeAudioGainDb,
    type StoredAudioClipRegion,
    type StoredAudioGain,
} from "@shared/types/audio";
import type { AssetExtras } from "@/lib/workspace/services/assets/types";
import { toAssetLoop, type LoopPoints } from "./loopHistory";

/**
 * The audio preview's playback gain: what it means, how it is stored, and the loudness alignment
 * that sets it.
 *
 * The gain turns a clip down in the game, to balance loudness across a project's clips. It never
 * turns one up - the engine clamps every volume to unity - so aligning a quiet clip to a louder
 * target leaves it where it is rather than promising a level the game will not play.
 *
 * Pure: no React, no services.
 */

/** The gain as the editor holds it. `db` is 0 for unity; `targetLufs` is set only by aligning. */
export interface ClipGain {
    db: number;
    targetLufs: number | null;
}

export const UNITY_GAIN: ClipGain = { db: 0, targetLufs: null };

/**
 * The loudness offered as a target until the project has one of its own.
 *
 * -16 LUFS is where most game and streaming music is levelled; a visual novel's BGM usually arrives
 * mastered far louder, so this brings it down to sit under dialogue rather than over it.
 */
export const DEFAULT_TARGET_LUFS = -16;

/** Targets outside this range are not a loudness anyone levels music to. */
export const MIN_TARGET_LUFS = -40;
export const MAX_TARGET_LUFS = -5;

export function sameGain(a: ClipGain, b: ClipGain): boolean {
    return a.db === b.db && a.targetLufs === b.targetLufs;
}

/** Clamp a gain to what the engine can play, to a tenth of a decibel. */
export function clampGainDb(db: number): number {
    if (!Number.isFinite(db)) {
        return 0;
    }
    const clamped = Math.max(AUDIO_GAIN_MIN_DB, Math.min(0, db));
    const rounded = Math.round(clamped * 10) / 10;
    // `-0` would print as "-0.0".
    return rounded === 0 ? 0 : rounded;
}

export function clampTargetLufs(lufs: number): number {
    if (!Number.isFinite(lufs)) {
        return DEFAULT_TARGET_LUFS;
    }
    return Math.round(Math.max(MIN_TARGET_LUFS, Math.min(MAX_TARGET_LUFS, lufs)) * 10) / 10;
}

export function gainFromAssetExtras(extras: AssetExtras | undefined): ClipGain {
    const db = normalizeAudioGainDb(extras) ?? 0;
    const target = extras?.audioGain?.targetLufs;
    return {
        db: clampGainDb(db),
        targetLufs: db !== 0 && typeof target === "number" && Number.isFinite(target) ? target : null,
    };
}

/** Back to the stored shape, or `undefined` at unity so the key leaves the record. */
export function toAssetGain(gain: ClipGain): StoredAudioGain | undefined {
    if (gain.db === 0) {
        return undefined;
    }
    return gain.targetLufs === null ? { db: gain.db } : { db: gain.db, targetLufs: gain.targetLufs };
}

/**
 * The gain that plays a clip measured at `measuredLufs` at `targetLufs`, never above unity.
 *
 * A clip already quieter than the target gets unity: raising it is the one thing the game cannot do.
 */
export function alignedGain(measuredLufs: number, targetLufs: number): ClipGain {
    const db = clampGainDb(Math.min(0, targetLufs - measuredLufs));
    return { db, targetLufs: db === 0 ? null : targetLufs };
}

/**
 * The target the project's clips were aligned to: the one most of them share, so opening another
 * clip offers the level its neighbours already sit at. Ties go to the quieter target, which is the
 * safer of the two to align a further clip to. The default when no clip has been aligned.
 */
export function projectTargetLufs(allExtras: Iterable<AssetExtras | undefined>): number {
    const counts = new Map<number, number>();
    for (const extras of allExtras) {
        const target = gainFromAssetExtras(extras).targetLufs;
        if (target !== null) {
            counts.set(target, (counts.get(target) ?? 0) + 1);
        }
    }
    let best: number | null = null;
    let bestCount = 0;
    for (const [target, count] of counts) {
        if (count > bestCount || (count === bestCount && best !== null && target < best)) {
            best = target;
            bestCount = count;
        }
    }
    return best ?? DEFAULT_TARGET_LUFS;
}

/** The linear factor a gain multiplies playback by. */
export function gainFactor(gain: ClipGain): number {
    return gain.db === 0 ? 1 : Math.pow(10, gain.db / 20);
}

/**
 * The markers as stored, with the file length alongside when the game needs it.
 *
 * An in or loop point with no out point ends at the end of the file, and the engine only honours a
 * loop point that has an end time beside it - so the file's length is recorded, with the hash of the
 * file it was measured on, whenever the markers take that shape. Any other shape stores none.
 */
export function toStoredRegion(
    loop: LoopPoints,
    file: { lengthMs: number; hash: string } | null,
): StoredAudioClipRegion | undefined {
    const region = toAssetLoop(loop);
    if (!region || !file || !regionNeedsLength(loop)) {
        return region;
    }
    return { ...region, fileLength: { ms: file.lengthMs, hash: file.hash } };
}

/** Whether these markers end at the end of the file rather than at an out point of their own. */
export function regionNeedsLength(loop: LoopPoints): boolean {
    return loop.outMs === null && (loop.inMs !== null || loop.loopStartMs !== null);
}

/**
 * Whether a stored region is missing the file length its markers need, or carries one measured on a
 * different file. What decides that an opened clip should record its length again.
 */
export function storedLengthIsStale(
    stored: StoredAudioClipRegion | undefined,
    loop: LoopPoints,
    file: { lengthMs: number; hash: string },
): boolean {
    if (!stored || !regionNeedsLength(loop)) {
        return false;
    }
    return stored.fileLength?.hash !== file.hash || stored.fileLength?.ms !== file.lengthMs;
}
