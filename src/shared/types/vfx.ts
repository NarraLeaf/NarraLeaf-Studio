/**
 * What the screen effects Studio bakes for a project are, as a picture in time.
 *
 * ## Why this is a project setting rather than a seed parameter
 *
 * Every other number behind a weather seed describes that one overlay: how many flakes, how fast
 * they fall, which way the wind blows. The frame rate describes none of them. It is the same answer
 * for every effect in the project, it is a trade between how the motion reads and what the package
 * costs, and an author who wanted smoother snow would otherwise have to make the same change on
 * every row that names a seed and keep them in step forever.
 *
 * ## What it reaches and what it does not
 *
 * Only clips Studio produces from a seed. Ambience clips the author imported travel through the
 * ordinary media path, which never restates a frame rate, so an imported file keeps the one it was
 * recorded at. There is nothing here that could change that, and the copy on the panel says so.
 *
 * Comments in English per project convention.
 */

/**
 * The rates offered, slowest first.
 *
 * Four positions rather than a free number. A clip's frame count is its own length times this, so
 * the bake time and the packaged bytes are strictly proportional to it - a typed 97 would cost 3.2x
 * what 30 does and buy nothing an eye can find over 120. The four are the rates displays and video
 * actually run at.
 *
 * The LENGTH is per effect (`WEATHER_PARAMS.loopSeconds`) and this is per project, which is the
 * split it sounds like: how smooth the motion is belongs to the game, how long before a particular
 * effect repeats belongs to that effect.
 */
export const VFX_FRAME_RATES = [30, 48, 60, 120] as const;

export type VfxFrameRate = (typeof VFX_FRAME_RATES)[number];

/**
 * The default, and the value every project that predates this setting is read as.
 *
 * Thirty because that is what every clip baked before the setting existed was baked at. A different
 * default would change the bake key of every seed in every existing project, which would be a
 * silent re-bake of work already on disk the first time an author opened one - see
 * `weatherBakeDescriptor`, which folds the rate into the identity precisely so that two rates
 * cannot share a file.
 */
export const DEFAULT_VFX_FRAME_RATE: VfxFrameRate = 30;

export type VfxConfiguration = {
    /** Frames per second in the clips baked from a weather seed. */
    frameRate: VfxFrameRate;
};

export const DEFAULT_VFX_CONFIGURATION: VfxConfiguration = {
    frameRate: DEFAULT_VFX_FRAME_RATE,
};

/**
 * Coerce a persisted value into a complete configuration.
 *
 * Dense like the autosave and dialogue policies next door: a bake needs a number whether or not the
 * author ever opened the page, and a reader that had to repeat the fallback is a reader that can
 * disagree with the one beside it. A rate this Studio does not offer falls back rather than being
 * kept, because the value is not a preference to preserve - it decides which file a story addresses,
 * and honouring an unknown one would address a file nothing else will ever bake.
 */
export function normalizeVfxConfiguration(value: unknown): VfxConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_VFX_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    const frameRate = VFX_FRAME_RATES.find(rate => rate === record.frameRate);
    return { frameRate: frameRate ?? DEFAULT_VFX_FRAME_RATE };
}

/** The rate a project's stored configuration means, for the callers that hold nothing else. */
export function vfxFrameRateOf(config: VfxConfiguration | undefined): VfxFrameRate {
    return config ? normalizeVfxConfiguration(config).frameRate : DEFAULT_VFX_FRAME_RATE;
}
