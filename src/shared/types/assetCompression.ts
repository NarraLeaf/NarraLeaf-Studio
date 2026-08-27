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
 * ## Two ways to say how much
 *
 * **Auto** is one number from 1 to 100 that means the same thing on every track:
 * high, intact to look at or listen to, and clearly smaller than the source. It
 * maps to whatever each encoder actually takes - a WebP quality, an AAC bitrate,
 * a VP9 CRF - and an author who has no opinion about any of those never meets
 * them.
 *
 * **Advanced** is those parameters themselves. It exists because the mapping is
 * a judgement, and an author who has measured their own material against their
 * own ears has a better one. Switching to it must *reveal* rather than change:
 * the settings UI seeds every advanced field from what auto was already doing,
 * so the first thing an author sees in advanced is the build they already had.
 *
 * The axis that is deliberately absent is still the platform. This is a
 * statement about the material, not about a target, so it applies to every
 * package a build produces: desktop, browser, Android, iOS. A per-platform
 * quality would be a matrix, and what a matrix costs is not screen space - it is
 * that no author could then say what their game looks or sounds like without
 * first naming where it was installed from.
 *
 * ## Which way to be wrong
 *
 * Everything in this area is ordered the same way: **safety first, and how much
 * it can compress second.** A build that leaves bytes on the table costs an
 * author a larger download; a build that ships altered artwork, a track that
 * lost its loop, or a file that no longer plays costs them work they cannot get
 * back. That is why a video carrying alpha is refused outright rather than
 * re-encoded, why an already-lossy source has to clear a much higher bar than a
 * lossless one, why the metadata pass drops only what it has a name for, and why
 * a format whose structure cannot be edited safely is left alone rather than
 * attempted. When a change here would trade one for the other, it goes the same
 * way.
 *
 * Shared because both sides read it: the project settings UI writes it into
 * `.nlproj`, and the build reads it back before it compiles anything.
 */

/** The three kinds of material a build compresses, each with its own switch. */
export type AssetCompressionTrack = "images" | "audio" | "video";

export const ASSET_COMPRESSION_TRACKS: readonly AssetCompressionTrack[] = ["images", "audio", "video"];

/** Whether a track is described by the shared 1-100 scale or by its encoder's own parameters. */
export type AssetCompressionMode = "auto" | "advanced";

export const ASSET_COMPRESSION_MODES: readonly AssetCompressionMode[] = ["auto", "advanced"];

/**
 * Flat rather than a record of settings per track, because this object is also a
 * diffable section of the project document: every field a version-control diff
 * can name has to be a leaf carrying a label of its own.
 */
export type AssetCompressionConfiguration = {
    /** Re-encode images as lossy WebP. */
    compressImages: boolean;
    imageMode: AssetCompressionMode;
    /** The shared scale, 1-100. Read only in `auto`. */
    imageQuality: number;
    /** The WebP quality passed to the encoder, 1-100. Read only in `advanced`. */
    imageWebpQuality: number;
    /**
     * Longest edge in pixels, or 0 to keep the size the artist saved. Read only in `advanced`.
     *
     * Only ever shrinks, and only images already larger than it. An artist working at twice the
     * stage size is common and shipping at twice the stage size is waste, but which of the two a
     * given project is doing is not something a build can tell, so nothing here guesses: auto never
     * resizes at all.
     */
    imageMaxDimension: number;

    /** Re-encode audio as AAC. */
    compressAudio: boolean;
    audioMode: AssetCompressionMode;
    /** The shared scale, 1-100. Read only in `auto`. */
    audioQuality: number;
    /** The AAC bitrate in kbit/s. Read only in `advanced`. */
    audioBitrateKbps: number;
    /**
     * Samples per second to cap at, or 0 to keep whatever the source has. Read only in `advanced`.
     *
     * A cap, never a target: a 44.1 kHz source stays at 44.1. Resampling up would spend the same
     * bitrate describing a band the recording never had.
     */
    audioSampleRateHz: number;

    /** Re-encode video as VP9. */
    compressVideo: boolean;
    videoMode: AssetCompressionMode;
    /** The shared scale, 1-100. Read only in `auto`. */
    videoQuality: number;
    /** The VP9 CRF, which runs the other way - lower is better. Read only in `advanced`. */
    videoCrf: number;
    /** Height in pixels to cap at, or 0 to keep the source's. Read only in `advanced`. */
    videoMaxHeight: number;
};

/** Guard rails for the shared scale; the settings UI offers the same range. */
export const ASSET_QUALITY_MIN = 1;
export const ASSET_QUALITY_MAX = 100;

/** Guard rails for the advanced fields, each the range its own encoder accepts. */
export const AUDIO_BITRATE_KBPS_MIN = 8;
export const AUDIO_BITRATE_KBPS_MAX = 512;
export const AUDIO_SAMPLE_RATE_MIN = 8_000;
export const AUDIO_SAMPLE_RATE_MAX = 192_000;
/**
 * VP9 accepts 0 to 63. The floor offered here is higher than 0 because a CRF in the single digits
 * produces a file larger than the source for no visible gain, and the ceiling is lower than 63
 * because VP9 much past 50 stops being a smaller version of the video and becomes a different one.
 */
export const VIDEO_CRF_MIN = 10;
export const VIDEO_CRF_MAX = 55;
/** A dimension cap has no useful ceiling; the floor is the point below which nothing is legible. */
export const DIMENSION_CAP_MIN = 16;
export const DIMENSION_CAP_MAX = 16_384;

/**
 * The quality every track starts at.
 *
 * One number across all three, because the scale is defined so that it promises
 * the same thing everywhere: high, intact to look at or listen to, and clearly
 * smaller than the source. What 82 costs in bits differs per track - see the
 * mappings below - but what it promises does not.
 */
export const DEFAULT_ASSET_QUALITY = 82;

/**
 * Everything off, and every advanced field holding what auto at the default
 * quality would have produced.
 *
 * That agreement is the point rather than a coincidence: turning on advanced
 * must not change a build by itself, so the stored defaults have to be auto's
 * own answers. `assetCompression.test.ts` asserts it, which is what keeps the
 * two from drifting when a mapping is retuned.
 */
export const DEFAULT_ASSET_COMPRESSION_CONFIGURATION: AssetCompressionConfiguration = {
    compressImages: false,
    imageMode: "auto",
    imageQuality: DEFAULT_ASSET_QUALITY,
    imageWebpQuality: DEFAULT_ASSET_QUALITY,
    imageMaxDimension: 0,

    compressAudio: false,
    audioMode: "auto",
    audioQuality: DEFAULT_ASSET_QUALITY,
    audioBitrateKbps: 168,
    audioSampleRateHz: 48_000,

    compressVideo: false,
    videoMode: "auto",
    videoQuality: DEFAULT_ASSET_QUALITY,
    videoCrf: 28,
    videoMaxHeight: 0,
};

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
 * and hear the result.
 */
export function audioBitrateKbpsForQuality(quality: number): number {
    const kbps = interpolate([[1, 32], [20, 64], [40, 96], [60, 128], [80, 160], [100, 256]], quality);
    // Multiples of eight: the numbers encoders, players and authors all print.
    return Math.max(32, Math.round(kbps / 8) * 8);
}

/**
 * Video quality as a VP9 CRF, which runs the other way - lower is better.
 */
export function videoCrfForQuality(quality: number): number {
    return Math.round(interpolate([[1, 50], [20, 45], [40, 38], [60, 33], [80, 29], [100, 15]], quality));
}

/**
 * Image quality as a WebP quality, which is the one mapping that is the identity.
 *
 * Written out anyway rather than left implicit, because "the scale happens to be
 * the encoder's scale here" is a fact about WebP, not a rule about the scale. A
 * second image encoder, or a WebP quality that stopped being 1-100, would change
 * this function and nothing else.
 */
export function imageWebpQualityForQuality(quality: number): number {
    // Same guard as {@link interpolate}: a non-number would otherwise become a
    // `NaN` in an encoder argument rather than a bad picture.
    const asked = Number.isFinite(quality) ? quality : DEFAULT_ASSET_QUALITY;
    return Math.min(ASSET_QUALITY_MAX, Math.max(ASSET_QUALITY_MIN, Math.round(asked)));
}

/* --- What a track resolves to, whichever mode it is in ------------------- */

/**
 * The rate auto caps a delivery copy at.
 *
 * 48 kHz is what every consumer output device runs at, and what a 96 kHz master
 * is resampled to on its way to one whatever this build does. Doing it in the
 * encoder rather than in the player means the bits are spent on the part of the
 * signal that survives the trip.
 */
export const DELIVERY_SAMPLE_RATE_HZ = 48_000;

/**
 * One track's policy, already reduced to what its encoder takes.
 *
 * The passes read these and never the mode: whether a number came from the
 * shared scale or from the author is a question for this file and the settings
 * panel, and answering it in an encoder argument builder is how the two modes
 * would start behaving differently for reasons nobody intended.
 */
export type ResolvedImageCompression = {
    enabled: boolean;
    /** WebP quality, 1-100. */
    quality: number;
    /** Longest edge to shrink to, or null to keep the source's size. */
    maxDimension: number | null;
};

export type ResolvedAudioCompression = {
    enabled: boolean;
    bitrateKbps: number;
    /** Rate to cap at, or null to keep the source's. */
    sampleRateHz: number | null;
};

export type ResolvedVideoCompression = {
    enabled: boolean;
    crf: number;
    /** Height to cap at, or null to keep the source's. */
    maxHeight: number | null;
};

export function resolveImageCompression(config: AssetCompressionConfiguration): ResolvedImageCompression {
    const advanced = config.imageMode === "advanced";
    return {
        enabled: config.compressImages,
        quality: advanced ? config.imageWebpQuality : imageWebpQualityForQuality(config.imageQuality),
        // Auto never resizes: a build cannot tell an artist working at twice the
        // stage size from one whose art is that size on purpose.
        maxDimension: advanced && config.imageMaxDimension > 0 ? config.imageMaxDimension : null,
    };
}

export function resolveAudioCompression(config: AssetCompressionConfiguration): ResolvedAudioCompression {
    const advanced = config.audioMode === "advanced";
    return {
        enabled: config.compressAudio,
        bitrateKbps: advanced ? config.audioBitrateKbps : audioBitrateKbpsForQuality(config.audioQuality),
        sampleRateHz: advanced
            ? (config.audioSampleRateHz > 0 ? config.audioSampleRateHz : null)
            : DELIVERY_SAMPLE_RATE_HZ,
    };
}

export function resolveVideoCompression(config: AssetCompressionConfiguration): ResolvedVideoCompression {
    const advanced = config.videoMode === "advanced";
    return {
        enabled: config.compressVideo,
        crf: advanced ? config.videoCrf : videoCrfForQuality(config.videoQuality),
        maxHeight: advanced && config.videoMaxHeight > 0 ? config.videoMaxHeight : null,
    };
}

/** Whether a track is on at all, for the callers that only need that much. */
export function assetTrackEnabled(
    config: AssetCompressionConfiguration,
    track: AssetCompressionTrack,
): boolean {
    if (track === "images") {
        return config.compressImages;
    }
    if (track === "audio") {
        return config.compressAudio;
    }
    return config.compressVideo;
}

/* --- Reading what is on disk --------------------------------------------- */

function clamp(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** A cap that is allowed to be off, which is 0 rather than a number in the range. */
function clampCap(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    const truncated = Math.trunc(parsed);
    return truncated <= 0 ? 0 : Math.min(max, Math.max(min, truncated));
}

function readMode(value: unknown): AssetCompressionMode {
    return value === "advanced" ? "advanced" : "auto";
}

/**
 * Coerce an unknown (persisted, partially-migrated, or absent) value into a
 * complete configuration.
 *
 * Note which way every fallback points: a malformed switch falls back to off,
 * and a malformed mode to auto. A config file hand-edited into nonsense must not
 * be able to turn on a step that cannot be undone, nor to move an author onto
 * numbers they never typed.
 */
export function normalizeAssetCompressionConfiguration(value: unknown): AssetCompressionConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    const fallback = DEFAULT_ASSET_COMPRESSION_CONFIGURATION;
    return {
        compressImages: record.compressImages === true,
        imageMode: readMode(record.imageMode),
        imageQuality: clamp(record.imageQuality, ASSET_QUALITY_MIN, ASSET_QUALITY_MAX, fallback.imageQuality),
        imageWebpQuality: clamp(
            record.imageWebpQuality, ASSET_QUALITY_MIN, ASSET_QUALITY_MAX, fallback.imageWebpQuality,
        ),
        imageMaxDimension: clampCap(
            record.imageMaxDimension, DIMENSION_CAP_MIN, DIMENSION_CAP_MAX, fallback.imageMaxDimension,
        ),

        compressAudio: record.compressAudio === true,
        audioMode: readMode(record.audioMode),
        audioQuality: clamp(record.audioQuality, ASSET_QUALITY_MIN, ASSET_QUALITY_MAX, fallback.audioQuality),
        audioBitrateKbps: clamp(
            record.audioBitrateKbps, AUDIO_BITRATE_KBPS_MIN, AUDIO_BITRATE_KBPS_MAX, fallback.audioBitrateKbps,
        ),
        audioSampleRateHz: clampCap(
            record.audioSampleRateHz, AUDIO_SAMPLE_RATE_MIN, AUDIO_SAMPLE_RATE_MAX, fallback.audioSampleRateHz,
        ),

        compressVideo: record.compressVideo === true,
        videoMode: readMode(record.videoMode),
        videoQuality: clamp(record.videoQuality, ASSET_QUALITY_MIN, ASSET_QUALITY_MAX, fallback.videoQuality),
        videoCrf: clamp(record.videoCrf, VIDEO_CRF_MIN, VIDEO_CRF_MAX, fallback.videoCrf),
        videoMaxHeight: clampCap(
            record.videoMaxHeight, DIMENSION_CAP_MIN, DIMENSION_CAP_MAX, fallback.videoMaxHeight,
        ),
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
 * means, and both predate the modes, so both land in auto.
 */
function migrateLegacyConfiguration(value: unknown): AssetCompressionConfiguration | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const quality = clamp(
        record.lossyQuality, ASSET_QUALITY_MIN, ASSET_QUALITY_MAX, DEFAULT_ASSET_QUALITY,
    );
    return {
        ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
        compressImages: record.lossyImages === true,
        imageQuality: quality,
        imageWebpQuality: imageWebpQualityForQuality(quality),
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

/**
 * What the advanced fields of one track should hold to mean what auto currently
 * means, so that turning advanced on reveals a build rather than changing one.
 *
 * Written by the settings UI at the moment the mode changes rather than computed
 * on read, because after that moment the numbers are the author's: an author who
 * moves the bitrate and later returns to auto and back must not have their own
 * figure quietly replaced by the mapping's.
 */
export function advancedSeedForTrack(
    config: AssetCompressionConfiguration,
    track: AssetCompressionTrack,
): Partial<AssetCompressionConfiguration> {
    if (track === "images") {
        return { imageWebpQuality: imageWebpQualityForQuality(config.imageQuality) };
    }
    if (track === "audio") {
        return {
            audioBitrateKbps: audioBitrateKbpsForQuality(config.audioQuality),
            audioSampleRateHz: DELIVERY_SAMPLE_RATE_HZ,
        };
    }
    return { videoCrf: videoCrfForQuality(config.videoQuality) };
}
