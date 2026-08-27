/**
 * Which of a project's sound and video a build may re-encode, and into what.
 *
 * The image side of this pipeline spends most of its length on reasons to say
 * no, because re-encoding an image is quietly destructive for a handful of
 * uncommon inputs. Sound and video have fewer such traps but two that matter
 * more, because a wrong answer here is silent in the literal sense:
 *
 *  - **a video carrying alpha loses it.** VP9 keeps an alpha plane in a side
 *    stream the container points at, and encoding to profile 0 - which is what
 *    every VP9 decoder is required to have - drops that stream without an error
 *    anywhere. A transparent effect clip would ship as a black rectangle over
 *    the scene;
 *  - **a file that is already lossy pays twice.** Re-encoding a 192 kbit/s MP3
 *    at 168 spends a whole generation of quality to save an eighth of the bytes.
 *    So an already-lossy source has to clear a much higher bar than the "any win
 *    at all" the size guard applies to a lossless one.
 *
 * The track is read from the streams rather than from the asset type. A `.mp4`
 * an author filed as video may hold nothing but a voice track, and it is the
 * audio switch that should decide its fate.
 */

import {
    assetTrackCompression,
    audioBitrateKbpsForQuality,
    videoCrfForQuality,
    type AssetCompressionConfiguration,
} from "@shared/types/assetCompression";
import { classifyStreams, probeCarriesAlpha, type ProbeReport } from "@shared/utils/mediaSupport";

export type AssetMediaSkipReason =
    /** Not an asset this pipeline re-encodes: an image, a font, a model. */
    | "unsupported"
    /** A file inside a model bundle; its name is referenced from the model's own manifest. */
    | "bundle-member"
    /** The switch for this file's track is off. */
    | "not-enabled"
    /** Small enough that the saving cannot pay for the encode. */
    | "too-small"
    /** A video whose transparency VP9 profile 0 would drop. */
    | "alpha"
    /** Nothing decodable in the file, so nothing to re-encode. */
    | "no-streams";

export type AssetMediaCompressionPlan =
    /** Re-encode as AAC in MP4, keep the result only if it is enough smaller. */
    | {
        action: "audio";
        bitrateKbps: number;
        lossySource: boolean;
        /**
         * Resample to this rate, or `null` to keep whatever the source has.
         *
         * Only ever set downwards, and only above the cap. At a fixed bitrate a higher rate does
         * not produce a bigger file - it produces a worse one, because the encoder spends the same
         * bits describing a band no listener has ever heard. Upsampling would be the same mistake
         * with the arrow reversed, which is why a 44.1 kHz source is left at 44.1.
         */
        sampleRateHz: number | null;
    }
    /** Re-encode as VP9 with Vorbis in WebM, keep the result only if it is enough smaller. */
    | { action: "video"; crf: number; lossySource: boolean }
    | { action: "skip"; reason: AssetMediaSkipReason };

export type AssetMediaCandidate = {
    /**
     * The asset manifest key. A bundle member is keyed `{assetId}/{pathInBundle}`,
     * which is the second signal that it is one.
     */
    manifestKey: string;
    /** The manifest's own asset type; anything but `audio` or `video` is left alone. */
    assetType?: string;
    /** Size of the source file. */
    byteLength: number;
    /** What ffprobe said about it. */
    report: ProbeReport;
};

/**
 * Asset types whose payload is a directory tree rather than a single file, and
 * whose internal file names are therefore load-bearing. Mirrors the same
 * constant in the image planner and in the artifact compiler.
 */
const BUNDLE_ASSET_TYPES: ReadonlySet<string> = new Set(["model"]);

/**
 * The floor under which a re-encode is not worth starting.
 *
 * Not about the saving being small - it is about what the saving is compared to.
 * Every candidate costs one process, and a project with ten thousand short voice
 * lines pays that ten thousand times. 16 KiB of AAC is about a second of speech;
 * below that there is no version of this that pays for itself.
 */
const MINIMUM_SOURCE_BYTES = 16 * 1024;

/**
 * Audio codecs that store the samples exactly.
 *
 * Everything else is treated as already lossy, including codecs nobody here has
 * measured. The asymmetry is the safe one: calling a lossless file lossy costs a
 * re-encode that gets discarded for being insufficiently smaller, while calling
 * a lossy file lossless spends a generation of quality on a file that had none
 * to spare.
 */
const LOSSLESS_AUDIO_CODECS: ReadonlySet<string> = new Set([
    "flac", "alac", "wavpack", "tta", "truehd", "mlp", "als", "ape", "shorten",
]);

function audioIsLossless(codec: string): boolean {
    // Every uncompressed variant ffprobe names starts `pcm_` - `pcm_s16le`,
    // `pcm_f32be`, `pcm_mulaw` - so the prefix covers the whole family without
    // enumerating a table that grows every time a format is added.
    return codec.startsWith("pcm_") || LOSSLESS_AUDIO_CODECS.has(codec);
}

export function planAssetMediaCompression(
    candidate: AssetMediaCandidate,
    config: AssetCompressionConfiguration,
): AssetMediaCompressionPlan {
    if (!candidate.assetType
        || BUNDLE_ASSET_TYPES.has(candidate.assetType)
        || candidate.manifestKey.includes("/")) {
        return { action: "skip", reason: "bundle-member" };
    }
    if (candidate.assetType !== "audio" && candidate.assetType !== "video") {
        return { action: "skip", reason: "unsupported" };
    }

    const streams = classifyStreams(candidate.report);
    const video = streams.filter(stream => stream.kind === "video");
    const audio = streams.filter(stream => stream.kind === "audio");
    if (video.length === 0 && audio.length === 0) {
        return { action: "skip", reason: "no-streams" };
    }

    // A file with a picture in it belongs to the video track whole, sound
    // included. Re-encoding only the audio of a video would mean copying the
    // video stream into a container chosen for the new audio codec, and the two
    // containers this pipeline can write disagree about which codecs they carry.
    const track = video.length > 0 ? "video" : "audio";
    const policy = assetTrackCompression(config, track);
    if (!policy.enabled) {
        return { action: "skip", reason: "not-enabled" };
    }
    if (candidate.byteLength < MINIMUM_SOURCE_BYTES) {
        return { action: "skip", reason: "too-small" };
    }

    if (track === "video") {
        if (probeCarriesAlpha(candidate.report)) {
            return { action: "skip", reason: "alpha" };
        }
        // Video sources are lossy in every practical case, and the ones that are
        // not are so much larger than anything VP9 produces that the bar makes
        // no difference to them.
        return { action: "video", crf: videoCrfForQuality(policy.quality), lossySource: true };
    }

    return {
        action: "audio",
        bitrateKbps: audioBitrateKbpsForQuality(policy.quality),
        lossySource: !audio.every(stream => audioIsLossless(stream.codec)),
        sampleRateHz: resampleTarget(candidate.report),
    };
}

/**
 * The rate a delivery copy is capped at.
 *
 * 48 kHz is what every consumer output device runs at, and what a 96 kHz master is resampled to
 * on its way to one whatever this build does. Doing it in the encoder rather than in the player
 * means the bits are spent on the part of the signal that survives the trip.
 */
const DELIVERY_SAMPLE_RATE_HZ = 48_000;

function resampleTarget(report: ProbeReport): number | null {
    let highest = 0;
    for (const stream of report.streams ?? []) {
        if ((stream.codec_type ?? "").toLowerCase() !== "audio") {
            continue;
        }
        const rate = Number.parseInt(stream.sample_rate ?? "", 10);
        if (Number.isFinite(rate)) {
            highest = Math.max(highest, rate);
        }
    }
    return highest > DELIVERY_SAMPLE_RATE_HZ ? DELIVERY_SAMPLE_RATE_HZ : null;
}

/**
 * Whether keeping the re-encoded bytes is actually a win.
 *
 * Two bars, because the two cases are paying for different things. A lossless
 * source loses nothing it can miss, so any real reduction is free and the floor
 * only has to clear the cost of shipping a file under a name the author does not
 * have on disk: one percent, or 1 KiB, whichever is met first - the same floor
 * the image pipeline uses.
 *
 * An already-lossy source is spending a generation of quality, and a saving of a
 * few percent is not worth that. A quarter of the file is the point where the
 * trade starts being one an author would make on purpose.
 */
export function assetMediaWorthKeeping(
    originalBytes: number,
    encodedBytes: number,
    lossySource: boolean,
): boolean {
    if (encodedBytes <= 0 || encodedBytes >= originalBytes) {
        return false;
    }
    const saved = originalBytes - encodedBytes;
    if (lossySource) {
        return saved >= originalBytes * 0.25;
    }
    return saved >= 1024 || saved >= originalBytes * 0.01;
}
