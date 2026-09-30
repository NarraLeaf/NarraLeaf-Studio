import { AUDIO_GAIN_MIN_DB, normalizeAudioGainDb, type StoredAudioGain } from "@shared/types/audio";
import type { AssetExtras } from "@/lib/workspace/services/assets/types";

/**
 * The audio preview's gain: how it is stored, and the loudness alignment that sets it.
 *
 * The gain turns a clip down in the game, to balance loudness across a project's clips. It never
 * turns one up - the engine clamps every volume to unity - so aligning a quiet clip leaves it where
 * it is rather than promising a level the game will not play.
 *
 * How a gain becomes a volume is not here: `clipVolume` in `@shared/types/audio` is the one place
 * that happens, for the preview's own monitoring as for every path that plays a clip in the game.
 *
 * Pure: no React, no services.
 */

/**
 * The loudness aligning brings a clip down to, in LUFS.
 *
 * Studio's choice rather than a field: which integrated loudness a game's clips should share is a
 * mastering question an author has no way to answer well, and one fixed level is what makes every
 * aligned clip sit with every other. -16 LUFS is where most game and streaming music is levelled; a
 * visual novel's BGM usually arrives mastered far louder, so this brings it down to sit under
 * dialogue rather than over it. The gain it produces stays the author's to change by hand.
 */
export const LOUDNESS_TARGET_LUFS = -16;

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

/** The stored gain in decibels, 0 at unity. */
export function gainFromAssetExtras(extras: AssetExtras | undefined): number {
    return clampGainDb(normalizeAudioGainDb(extras) ?? 0);
}

/** Back to the stored shape, or `undefined` at unity so the key leaves the record. */
export function toAssetGain(db: number): StoredAudioGain | undefined {
    return db === 0 ? undefined : { db };
}

/**
 * The gain that plays a clip measured at `measuredLufs` at {@link LOUDNESS_TARGET_LUFS}, never above
 * unity. A clip already quieter than the target gets unity: raising it is the one thing the game
 * cannot do.
 */
export function alignedGainDb(measuredLufs: number): number {
    return clampGainDb(Math.min(0, LOUDNESS_TARGET_LUFS - measuredLufs));
}
