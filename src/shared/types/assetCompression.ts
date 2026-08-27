/**
 * What a build is allowed to discard from the author's media on the way out.
 *
 * There is one kind of decision on this page, and the reason there is only one
 * is worth stating, because the obvious design has twice as many.
 *
 * A step that cannot cost the author anything needs no permission. Converting an
 * image to lossless WebP is verified pixel for pixel against the source and
 * thrown away unless it matches; removing the camera model and the artist's home
 * directory from a file's metadata takes out nothing a renderer reads; writing
 * `.br` and `.gz` siblings beside a site's text leaves the originals in place.
 * None of those is a question anybody can answer wrongly, so none of them is a
 * setting: they are what a build does. Internally that half of the pipeline is
 * called optimization, and the author never meets the word.
 *
 * What is left is compression, and compression here means exactly one thing:
 * information that was in the file is not in the shipped copy, and cannot be got
 * back. That is true whether or not anyone can hear or see the difference - a
 * voice line resampled down from 96 kHz is compressed even where no listener
 * could pass a blind test, and it is filed under this setting rather than under
 * the silent half for that reason. Only the author can say their material can
 * afford that, so it is asked, and it is the whole of what is asked.
 *
 * ## One switch per track
 *
 * The tracks are separate because the material is. A project can be mostly
 * hand-drawn artwork that has to stay exact next to forty hours of recorded
 * voice nobody will ever A/B, and one switch covering both would force the
 * author to name which of the two they care about less.
 *
 * The axis that is deliberately absent is still the platform. This is a
 * statement about the material, not about a target, so it applies to every
 * package a build produces: desktop, browser, Android, iOS. A per-platform
 * quality would be a matrix, and what a matrix costs is not screen space - it is
 * that no author could then say what their game looks or sounds like without
 * first naming where it was installed from.
 *
 * Shared because both sides read it: the project settings UI writes it into
 * `.nlproj`, and the build reads it back before it compiles anything.
 */

/** The three kinds of material a build compresses, each with its own switch. */
export type AssetCompressionTrack = "images" | "audio" | "video";

export const ASSET_COMPRESSION_TRACKS: readonly AssetCompressionTrack[] = ["images", "audio", "video"];

/**
 * Flat rather than a record of `{enabled, quality}` per track, because this
 * object is also a diffable section of the project document: every field a
 * version-control diff can name has to be a leaf carrying a label of its own.
 */
export type AssetCompressionConfiguration = {
    /** Re-encode images as lossy WebP. */
    compressImages: boolean;
    /** Quality for {@link compressImages}, 1-100. Ignored while that is off. */
    imageQuality: number;
    /** Re-encode audio as AAC. */
    compressAudio: boolean;
    /** Quality for {@link compressAudio}, 1-100. Ignored while that is off. */
    audioQuality: number;
    /** Re-encode video as VP9. */
    compressVideo: boolean;
    /** Quality for {@link compressVideo}, 1-100. Ignored while that is off. */
    videoQuality: number;
};

/** Guard rails for the authored quality; the settings UI offers the same range. */
export const ASSET_QUALITY_MIN = 1;
export const ASSET_QUALITY_MAX = 100;

/**
 * The quality every track starts at.
 *
 * One number across all three, and the same one the image setting has always
 * defaulted to, because the scale is defined so that it promises the same thing
 * everywhere: high, intact to look at or listen to, and clearly smaller than the
 * source. What 82 costs in bits differs per track - see the mappings below -
 * but what it promises does not.
 */
export const DEFAULT_ASSET_QUALITY = 82;

/**
 * Everything off: what a project that never opened this panel means, and what
 * every project predating the setting gets.
 */
export const DEFAULT_ASSET_COMPRESSION_CONFIGURATION: AssetCompressionConfiguration = {
    compressImages: false,
    imageQuality: DEFAULT_ASSET_QUALITY,
    compressAudio: false,
    audioQuality: DEFAULT_ASSET_QUALITY,
    compressVideo: false,
    videoQuality: DEFAULT_ASSET_QUALITY,
};

/** One track's policy, for the passes that handle exactly one kind of file. */
export type TrackCompression = {
    enabled: boolean;
    quality: number;
};

export function assetTrackCompression(
    config: AssetCompressionConfiguration,
    track: AssetCompressionTrack,
): TrackCompression {
    if (track === "images") {
        return { enabled: config.compressImages, quality: config.imageQuality };
    }
    if (track === "audio") {
        return { enabled: config.compressAudio, quality: config.audioQuality };
    }
    return { enabled: config.compressVideo, quality: config.videoQuality };
}

function clampQuality(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(ASSET_QUALITY_MAX, Math.max(ASSET_QUALITY_MIN, Math.trunc(parsed)));
}

/**
 * Coerce an unknown (persisted, partially-migrated, or absent) value into a
 * complete configuration.
 *
 * Note which way every fallback points: a malformed switch falls back to off. A
 * config file hand-edited into nonsense must not be able to turn on a step that
 * cannot be undone.
 */
export function normalizeAssetCompressionConfiguration(value: unknown): AssetCompressionConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    return {
        compressImages: record.compressImages === true,
        imageQuality: clampQuality(record.imageQuality, DEFAULT_ASSET_QUALITY),
        compressAudio: record.compressAudio === true,
        audioQuality: clampQuality(record.audioQuality, DEFAULT_ASSET_QUALITY),
        compressVideo: record.compressVideo === true,
        videoQuality: clampQuality(record.videoQuality, DEFAULT_ASSET_QUALITY),
    };
}

/**
 * The two shapes this setting has had before, in the order they were written.
 *
 * `app.webOptimization` held the image switch alongside two more for steps that
 * are now unconditional; `app.assetOptimization` dropped those two and kept the
 * image pair under the names `lossyImages` and `lossyQuality`. Both are read for
 * their image fields and nothing else - the tracks that did not exist then start
 * off, which is what a project that never expressed an opinion about its audio
 * means.
 */
function migrateLegacyConfiguration(value: unknown): AssetCompressionConfiguration | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    return {
        ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
        compressImages: record.lossyImages === true,
        imageQuality: clampQuality(record.lossyQuality, DEFAULT_ASSET_QUALITY),
    };
}

/**
 * The policy a project's `app` config states, reading the keys this setting used
 * to live under when it has not been written since.
 */
export function readAssetCompressionConfiguration(app: unknown): AssetCompressionConfiguration {
    if (!app || typeof app !== "object") {
        return { ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION };
    }
    const record = app as { assetCompression?: unknown; assetOptimization?: unknown; webOptimization?: unknown };
    if (record.assetCompression && typeof record.assetCompression === "object") {
        return normalizeAssetCompressionConfiguration(record.assetCompression);
    }
    return migrateLegacyConfiguration(record.assetOptimization ?? record.webOptimization)
        ?? { ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION };
}

/* --- What a quality means, per track ------------------------------------- */

/**
 * Interpolate a value from a table of (quality, value) anchors.
 *
 * A table rather than a formula because none of the scales below is linear in
 * anything, and each was pinned at points that can be argued about
 * individually. Anchors ascend by quality; the value may run either way.
 */
function interpolate(anchors: readonly (readonly [number, number])[], quality: number): number {
    // A non-number reaching an encoder argument would be a `NaN` in an argv, so
    // it lands on the default instead. The normalizer upstream makes this
    // unreachable from a project file; these functions are exported and callable
    // from elsewhere, and an unusable command line is not the way to find out.
    const asked = Number.isFinite(quality) ? quality : DEFAULT_ASSET_QUALITY;
    const q = Math.min(ASSET_QUALITY_MAX, Math.max(ASSET_QUALITY_MIN, asked));
    for (let i = 1; i < anchors.length; i += 1) {
        const [highQuality, highValue] = anchors[i];
        if (q > highQuality) {
            continue;
        }
        const [lowQuality, lowValue] = anchors[i - 1];
        const span = highQuality - lowQuality;
        const t = span === 0 ? 0 : (q - lowQuality) / span;
        return lowValue + (highValue - lowValue) * t;
    }
    return anchors[anchors.length - 1][1];
}

/**
 * Audio quality as an AAC bitrate in kbit/s.
 *
 * A bitrate rather than the encoder's own VBR scale, because the encoder that
 * ships is libavcodec's native `aac`: its VBR mode is still marked experimental
 * and its quality numbers have moved between releases, while a bitrate means the
 * same thing in every FFmpeg that has ever existed.
 *
 * The default lands near 168 kbit/s, which is generous for a codec usually
 * called transparent by 128. That is deliberate. This switch re-encodes every
 * voice line in a project at once and the result is what ships, so the default
 * is not the place to be clever; an author who wants the smaller file can say so
 * on a slider and hear the result.
 */
export function audioBitrateKbpsForQuality(quality: number): number {
    const kbps = interpolate([[1, 32], [20, 64], [40, 96], [60, 128], [80, 160], [100, 256]], quality);
    // Multiples of eight: the numbers encoders, players and authors all print.
    return Math.max(32, Math.round(kbps / 8) * 8);
}

/**
 * Video quality as a VP9 CRF, which runs the other way - lower is better.
 *
 * 63 is not the bottom of the range offered here. VP9 much below 50 stops being
 * a smaller version of the video and becomes a different one, and nothing on a
 * page whose control is labelled quality should be able to produce that.
 */
export function videoCrfForQuality(quality: number): number {
    return Math.round(interpolate([[1, 50], [20, 45], [40, 38], [60, 33], [80, 29], [100, 15]], quality));
}
