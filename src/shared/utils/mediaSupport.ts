/**
 * Whether the engine can play a media file, decided from what is actually inside it.
 *
 * The judgement is on the pair **(container, codec of every stream)**, never on the extension. A
 * `.mp4` holding H.264 plays; a `.mp4` holding HEVC is a black rectangle with sound. Both are
 * `.mp4`, so any rule written against the file name is wrong about one of them.
 *
 * Everything in this module is pure: it takes an already-parsed ffprobe report and returns a
 * verdict. It never spawns a binary, never touches `fs`, and can therefore be tested on a machine
 * with no ffprobe at all. The process that produces the report lives in
 * `src/main/app/application/managers/media/mediaProbe.ts`.
 *
 * ## Where the tables come from
 *
 * **Every entry in the tables below was measured**, not inferred from documentation. The method
 * was to build one sample per axis with ffmpeg and load it in the engine's own renderer:
 *
 *   - *Container axis*: each container was filled with a codec already known to decode, so a
 *     failure can only be the container's fault.
 *   - *Codec axis*: each codec was muxed into a container already known to demux, so a failure can
 *     only be the codec's fault.
 *
 * The two failures report differently, and that difference is the whole basis for the four tiers:
 * a container the demuxer will not open fails with `DEMUXER_ERROR_COULD_NOT_OPEN`, while a
 * container that opens but yields nothing playable fails with
 * `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`.
 *
 * **Measurement environment: Electron 38.8.6 / Chromium 140, on 2026-08-06.** That is the number
 * that matters if you are about to change a row here. Chromium's bundled decoder set moves between
 * majors, and the tables are only true of the runtime the engine actually ships. Do not add a row
 * because a codec "should" work, and do not delete one because a spec says it is obsolete —
 * rebuild the samples, run them through the shipped renderer, and record what happened.
 *
 * ## The four tiers
 *
 *   - `accept`   — container demuxes and every stream's codec decodes. Import the bytes unchanged.
 *   - `remux`    — every codec decodes, but the container does not demux. `-c copy` into a
 *                  container that does. Lossless and roughly disk-speed.
 *   - `reencode` — at least one codec does not decode. Lossy, slow, unavoidable.
 *   - `refuse`   — not a decodable media file at all.
 *
 * Remuxing cannot rescue a codec problem: an AVI carrying MPEG-4 Part 2, `-c copy`-ed into an MP4,
 * still has a dead video track — the container changed and the bytes the decoder chokes on did
 * not. That is why `remux` requires *every* codec to be supported, and why an unsupported codec
 * sends the file to `reencode` no matter how playable its container is.
 */

/** What the classifier can conclude. Ordered cheapest to most expensive. */
export type MediaSupportTier = "accept" | "remux" | "reencode" | "refuse";

/** Why, in one machine-readable token. UI copy is the caller's business. */
export type MediaSupportReason =
    /** Container demuxes, every codec decodes. */
    | "playable"
    /** Every codec decodes; the container does not demux. */
    | "container-unsupported"
    /** At least one stream's codec does not decode. */
    | "codec-unsupported"
    /** The container demuxes but carries no audio and no video. */
    | "no-streams"
    /** The file name says this is not decodable media (playlist, DRM wrapper, MIDI). */
    | "not-media"
    /**
     * Every codec decodes and the container does not, but no container this project is willing to
     * write can legally carry the combination. Falls through to `reencode`.
     */
    | "no-remux-container";

/* -------------------------------------------------------------------------------------------- */
/* Containers                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * Container names Chromium's demuxer opens, as ffprobe spells them in `format.format_name`.
 *
 * Measured by muxing a known-decodable codec into each one. Chromium's failure for anything absent
 * here is `DEMUXER_ERROR_COULD_NOT_OPEN`, which is raised before a decoder is ever consulted.
 *
 * `mov`/`mp4`/`m4a`/`3gp`/`3g2`/`mj2` are one demuxer, not six containers — see
 * {@link containerNames} for why the whole family is listed rather than the string matched.
 */
const DEMUXABLE_CONTAINERS: ReadonlySet<string> = new Set([
    // ISO-BMFF family. ffprobe names the demuxer, and the demuxer answers to all of these.
    "mov", "mp4", "m4a", "3gp", "3g2", "mj2",
    // Matroska and WebM are also one demuxer. Chromium's Matroska support is *not* restricted to
    // the WebM codec set: MP3, FLAC and PCM in `.mkv` all decoded in the measurement.
    "matroska", "webm",
    "ogg",
    "mp3",
    "wav",
    "flac",
    // ADTS AAC. Raw elementary stream, no container framing beyond the sync words.
    "aac",
]);

/**
 * Containers measured as *not* openable — `DEMUXER_ERROR_COULD_NOT_OPEN` every time, even when the
 * codec inside was one Chromium decodes happily elsewhere.
 *
 * Recorded rather than left to the default because "we tried it and it does not work" and "we have
 * never heard of it" are different facts, and the next person deserves to know which one this is.
 * Both route to the same verdict; only this list is evidence.
 *
 * `mp2` is deliberately absent even though the raw MPEG-1 Layer II container was measured as
 * unopenable: ffprobe never *reports* `mp2`. Its mpegaudio demuxer is named `mp3`, so such a file
 * arrives here as container `mp3` (openable) carrying codec `mp2` (not decodable), and lands on
 * `reencode` — the right answer by the other axis. The row would be unreachable, and an unreachable
 * row is a lie waiting to be believed.
 */
const KNOWN_UNDEMUXABLE_CONTAINERS: ReadonlySet<string> = new Set([
    "avi",
    // Windows Media. ffprobe reports `asf` for both `.wmv` and `.wma`.
    "asf",
    "flv",
    // MPEG program stream.
    "mpeg",
    // MPEG transport stream.
    "mpegts",
    "aiff",
]);

/* -------------------------------------------------------------------------------------------- */
/* Codecs                                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Video codecs Chromium decodes, as ffprobe spells them in `codec_name`.
 *
 * Measured inside a container already known to demux, so a failure could only be the codec's.
 * H.264 was additionally checked at High 10 (10-bit), which decodes.
 *
 * **AV1 decodes but must never be chosen as an encode target** — see {@link TRANSCODE_TARGET}.
 */
const DECODABLE_VIDEO_CODECS: ReadonlySet<string> = new Set([
    "h264",
    "vp8",
    "vp9",
    "av1",
]);

/**
 * Video codecs measured as *not* decodable: the container opened, the stream was found, and
 * playback failed with `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`.
 *
 * `hevc` is the expensive one in practice — phone cameras and screen recorders default to it, so
 * this is the row most authors will meet.
 */
const KNOWN_UNDECODABLE_VIDEO_CODECS: ReadonlySet<string> = new Set([
    "hevc",
    "mpeg2video",
    // MPEG-4 Part 2 (DivX/Xvid). Not to be confused with H.264, which is MPEG-4 Part 10.
    "mpeg4",
    "prores",
    "theora",
    "wmv2",
]);

/**
 * Audio codecs Chromium decodes.
 *
 * The PCM entries need a word. **Only `pcm_s16le` was measured.** The others are the
 * little-endian and companded variants Chromium's bundled FFmpeg carries, listed explicitly rather
 * than matched with a `pcm_` prefix on purpose: a prefix would also swallow big-endian and exotic
 * variants that were never measured, and being wrong there means saying `accept` about a file that
 * will not play — the one direction of error with no recovery. An unlisted PCM variant falls to
 * `reencode`, which merely wastes a few seconds.
 */
const DECODABLE_AUDIO_CODECS: ReadonlySet<string> = new Set([
    "aac",
    "mp3",
    "opus",
    "vorbis",
    "flac",
    "pcm_s16le",
    "pcm_u8",
    "pcm_s24le",
    "pcm_s32le",
    "pcm_f32le",
    "pcm_alaw",
    "pcm_mulaw",
]);

/** Audio codecs measured as not decodable. Same evidence-vs-ignorance distinction as the video list. */
const KNOWN_UNDECODABLE_AUDIO_CODECS: ReadonlySet<string> = new Set([
    "ac3",
    // Apple Lossless. Decoded by Safari, not by Chromium — an easy one to assume works.
    "alac",
    "wmav2",
]);

/* -------------------------------------------------------------------------------------------- */
/* Refused by name                                                                                */
/* -------------------------------------------------------------------------------------------- */

/**
 * Extensions that are refused without probing, lowercase and without the dot.
 *
 * These are not "unsupported media" — they are not media. A playlist is a list of other files, a
 * `.m4p` is a DRM wrapper whose payload is encrypted, and a MIDI file is a score with no audio in
 * it at all. None of the three has a transcode that would produce what the author expected, so
 * offering one would be worse than refusing.
 *
 * Playlists carry a second reason to stop *before* spawning anything: FFmpeg's playlist demuxers
 * resolve the entries they contain, and an entry can be an `http://` URL. Handing an author-supplied
 * `.m3u8` to ffprobe is handing a stranger's file a network fetch from the main process. Refusing
 * by name keeps that path from existing.
 */
const REFUSED_EXTENSIONS: ReadonlySet<string> = new Set([
    "m3u",
    "m3u8",
    "pls",
    "m4p",
    "mid",
    "midi",
]);

/**
 * True when the file name alone is enough to refuse, so the caller can skip the probe entirely.
 *
 * Accepts a full path or a bare name.
 */
export function isRefusedMediaFileName(fileName: string): boolean {
    const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
    const dot = base.lastIndexOf(".");
    if (dot <= 0) {
        return false;
    }
    return REFUSED_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

/* -------------------------------------------------------------------------------------------- */
/* Probe report shape                                                                             */
/* -------------------------------------------------------------------------------------------- */

/** One stream as ffprobe reports it. Field names are ffprobe's, so a report can be handed over raw. */
export type ProbeStream = {
    index?: number;
    codec_type?: string;
    codec_name?: string;
    /** ffprobe's disposition bag. Only `attached_pic` is read; the rest is carried along untouched. */
    disposition?: Record<string, number | undefined>;
};

/** The subset of `ffprobe -show_format -show_streams` output this module reads. */
export type ProbeReport = {
    format?: {
        /** Comma-separated **list** of demuxer aliases, e.g. `mov,mp4,m4a,3gp,3g2,mj2`. */
        format_name?: string;
    };
    streams?: ProbeStream[];
};

/**
 * Split `format.format_name` into its alias tokens.
 *
 * ffprobe reports the *demuxer's* name here, and a demuxer that handles a family of related
 * containers is named after all of them at once. An ISO-BMFF file arrives as
 * `mov,mp4,m4a,3gp,3g2,mj2` whatever its extension, and Matroska and WebM arrive as
 * `matroska,webm`. Comparing the whole string against `"mp4"` therefore matches nothing, ever —
 * and the token list is not even stable across FFmpeg versions: the `mj2` alias is present on
 * FFmpeg 8 and was not on older builds. Splitting is the only thing that survives that.
 */
export function containerNames(report: ProbeReport): string[] {
    return (report.format?.format_name ?? "")
        .split(",")
        .map(name => name.trim().toLowerCase())
        .filter(name => name.length > 0);
}

/**
 * Whether Chromium's demuxer opens this container.
 *
 * **Any** alias being demuxable is enough, rather than all of them. The tokens name one demuxer,
 * so they describe one family of bytes, not a set of possibilities to be intersected; and treating
 * an unrecognised alias as disqualifying would mean a future FFmpeg adding a name to the ISO-BMFF
 * list silently reclassified every MP4 in every project. Where a family really does straddle the
 * line — `mj2` inside the ISO-BMFF list — the codec axis catches it, because a Motion JPEG 2000
 * file's `jpeg2000` stream is not decodable.
 */
export function isDemuxableContainer(names: readonly string[]): boolean {
    return names.some(name => DEMUXABLE_CONTAINERS.has(name));
}

/* -------------------------------------------------------------------------------------------- */
/* Streams                                                                                        */
/* -------------------------------------------------------------------------------------------- */

export type MediaStreamKind = "video" | "audio";

/** One stream, reduced to the two facts the verdict turns on. */
export type ClassifiedStream = {
    /** ffprobe's stream index, or the array position when the report omits it. */
    index: number;
    kind: MediaStreamKind;
    /** ffprobe's `codec_name`, lowercased. Empty string when the report omits it. */
    codec: string;
    /** Whether Chromium decodes it. Unknown codecs are `false` — see {@link isDecodableCodec}. */
    decodable: boolean;
};

/**
 * Reduce a report's streams to the ones that decide playability.
 *
 * Two exclusions, both of which cost real money if forgotten:
 *
 *  1. **Only `video` and `audio` count.** Subtitle, data and attachment streams are ignored. A
 *     perfectly playable MP4 with a `mov_text` subtitle track must not be downgraded because of a
 *     codec the engine never asks a decoder for.
 *  2. **Cover art is not video.** An MP3 with embedded album art reports a second stream whose
 *     `codec_type` is `video` and whose `codec_name` is `png` or `mjpeg`, distinguished only by
 *     `disposition.attached_pic`. Without this guard every tagged MP3 in an author's music folder
 *     classifies as `reencode` — a slow, lossy, entirely pointless re-encode of a file that plays
 *     fine. Measured: `ffprobe` on an MP3 with a cover reports exactly this.
 */
export function classifyStreams(report: ProbeReport): ClassifiedStream[] {
    const streams = report.streams ?? [];
    const out: ClassifiedStream[] = [];
    streams.forEach((stream, position) => {
        const type = (stream.codec_type ?? "").toLowerCase();
        if (type !== "video" && type !== "audio") {
            return;
        }
        if (type === "video" && stream.disposition?.attached_pic === 1) {
            return;
        }
        const codec = (stream.codec_name ?? "").toLowerCase();
        out.push({
            index: typeof stream.index === "number" ? stream.index : position,
            kind: type,
            codec,
            decodable: isDecodableCodec(type, codec),
        });
    });
    return out;
}

/**
 * Whether Chromium decodes this codec.
 *
 * Unknown names answer `false`. The asymmetry is deliberate: guessing "supported" about a codec
 * nobody measured ships a file that renders as a black rectangle, while guessing "unsupported"
 * costs one unnecessary re-encode. Only one of those is recoverable.
 */
export function isDecodableCodec(kind: MediaStreamKind, codec: string): boolean {
    const name = codec.toLowerCase();
    return kind === "video"
        ? DECODABLE_VIDEO_CODECS.has(name)
        : DECODABLE_AUDIO_CODECS.has(name);
}

/**
 * Whether this codec is on the measured *failure* list, as opposed to merely unrecognised.
 *
 * Not used by the verdict — both route to `reencode`. It exists so a caller can tell an author
 * "HEVC does not play" rather than "we are not sure about HEVC", and so a future change to the
 * tables can be checked against what was actually observed.
 */
export function isKnownUndecodableCodec(kind: MediaStreamKind, codec: string): boolean {
    const name = codec.toLowerCase();
    return kind === "video"
        ? KNOWN_UNDECODABLE_VIDEO_CODECS.has(name)
        : KNOWN_UNDECODABLE_AUDIO_CODECS.has(name);
}

/** Whether this container is on the measured failure list, rather than merely unrecognised. */
export function isKnownUndemuxableContainer(names: readonly string[]): boolean {
    return names.some(name => KNOWN_UNDEMUXABLE_CONTAINERS.has(name));
}

/* -------------------------------------------------------------------------------------------- */
/* Targets                                                                                        */
/* -------------------------------------------------------------------------------------------- */

/** Containers this project is willing to write. Deliberately short — see {@link remuxContainerFor}. */
export type TranscodeContainer = "webm" | "mp4" | "ogg" | "mp3" | "flac" | "wav" | "aac";

export type TranscodeVideoCodec = "vp9";
export type TranscodeAudioCodec = "vorbis";

/**
 * The re-encode target, decided once for the whole project.
 *
 * **VP9 video + Vorbis audio in WebM, with an iOS 17.4 floor.** Two constraints pin it there:
 *
 *  - *Licensing.* libvpx and libvorbis are BSD, so an LGPL FFmpeg build can produce this. H.264
 *    and HEVC would need libx264/libx265, which are GPL, and shipping those inside the installer
 *    is a distribution decision this pipeline is not allowed to make on its own.
 *  - *Reach.* WebM audio and video are supported by Safari from iOS 17.4, which is the floor this
 *    project already targets. AV1 decodes in Chromium and is tempting as a smaller-for-quality
 *    alternative, **and it is the wrong choice**: iOS supports AV1 only on devices with a hardware
 *    decoder, so an AV1 re-encode would play on a desktop test and fail on the author's phone.
 */
export const TRANSCODE_TARGET = {
    container: "webm",
    video: "vp9",
    audio: "vorbis",
} as const satisfies {
    container: TranscodeContainer;
    video: TranscodeVideoCodec;
    audio: TranscodeAudioCodec;
};

/** What the caller should do about the file. `null` when there is nothing to do or nothing to be done. */
export type MediaSupportTarget =
    | {
        kind: "remux";
        /**
         * Container to `-c copy` into. Only video and audio streams should be mapped across:
         * subtitle and data tracks may not be legal in the destination and are not played anyway.
         */
        container: TranscodeContainer;
    }
    | {
        kind: "reencode";
        container: TranscodeContainer;
        /** `null` when the source has no video streams, so no video encoder should be configured. */
        video: TranscodeVideoCodec | null;
        /** `null` when the source has no audio streams. */
        audio: TranscodeAudioCodec | null;
    };

/** Codecs WebM may legally carry. Both lists are the format's, not Chromium's. */
const WEBM_VIDEO_CODECS: ReadonlySet<string> = new Set(["vp8", "vp9", "av1"]);
const WEBM_AUDIO_CODECS: ReadonlySet<string> = new Set(["opus", "vorbis"]);

/**
 * Codecs this project is willing to put in an MP4.
 *
 * Shorter than what ISO-BMFF permits, on purpose. VP9-in-MP4, Opus-in-MP4 and FLAC-in-MP4 are all
 * standardised and probably fine, and **none of them was measured**. Leaving them out sends those
 * (rare) combinations to `reencode` instead of producing a remux that might not play — the same
 * pessimism the codec tables use, for the same reason.
 */
const MP4_VIDEO_CODECS: ReadonlySet<string> = new Set(["h264", "av1"]);
const MP4_AUDIO_CODECS: ReadonlySet<string> = new Set(["aac", "mp3"]);

/**
 * For an audio-only file, the container that codec natively lives in.
 *
 * Tried first, before WebM and MP4, because it is the least surprising answer: an AIFF full of PCM
 * becomes a `.wav`, not a `.webm` with one audio track. It also covers the two codecs neither
 * WebM nor MP4 will take — FLAC and PCM — which would otherwise be re-encoded for no reason.
 */
const AUDIO_ONLY_CONTAINERS: ReadonlyMap<string, TranscodeContainer> = new Map<string, TranscodeContainer>([
    ["flac", "flac"],
    ["mp3", "mp3"],
    ["aac", "aac"],
    ["vorbis", "ogg"],
    ["opus", "ogg"],
    ["pcm_s16le", "wav"],
    ["pcm_u8", "wav"],
    ["pcm_s24le", "wav"],
    ["pcm_s32le", "wav"],
    ["pcm_f32le", "wav"],
    ["pcm_alaw", "wav"],
    ["pcm_mulaw", "wav"],
]);

/**
 * Which container to `-c copy` these streams into, or `null` if none will take them.
 *
 * Called only when every codec already decodes, so the question is purely one of what the
 * destination format is *allowed* to hold. Getting this wrong is not a cosmetic error: proposing
 * WebM for an H.264 stream produces a remux command that fails, or worse, a file that does not
 * play. Hence the order — most specific first, and a `null` (meaning "fall through to re-encode")
 * rather than a guess.
 */
export function remuxContainerFor(streams: readonly ClassifiedStream[]): TranscodeContainer | null {
    const video = streams.filter(stream => stream.kind === "video");
    const audio = streams.filter(stream => stream.kind === "audio");

    if (video.length === 0 && audio.length === 1) {
        const native = AUDIO_ONLY_CONTAINERS.get(audio[0].codec);
        if (native) {
            return native;
        }
    }
    if (
        video.every(stream => WEBM_VIDEO_CODECS.has(stream.codec))
        && audio.every(stream => WEBM_AUDIO_CODECS.has(stream.codec))
    ) {
        return "webm";
    }
    if (
        video.every(stream => MP4_VIDEO_CODECS.has(stream.codec))
        && audio.every(stream => MP4_AUDIO_CODECS.has(stream.codec))
    ) {
        return "mp4";
    }
    return null;
}

/* -------------------------------------------------------------------------------------------- */
/* Verdict                                                                                        */
/* -------------------------------------------------------------------------------------------- */

export type MediaSupportVerdict = {
    tier: MediaSupportTier;
    reason: MediaSupportReason;
    container: {
        /** The demuxer alias tokens, as split from `format_name`. Empty when the report had none. */
        names: string[];
        demuxable: boolean;
        /** True when the container is on the measured failure list rather than merely unrecognised. */
        knownUnsupported: boolean;
    };
    /** Video and audio streams only; cover art, subtitles and data tracks are already gone. */
    streams: ClassifiedStream[];
    /** Codec names, deduplicated, that sent this file to `reencode`. Empty otherwise. */
    unsupportedCodecs: string[];
    /** What to do. `null` for `accept` (nothing to do) and `refuse` (nothing to be done). */
    target: MediaSupportTarget | null;
};

/**
 * The whole decision, from a parsed ffprobe report.
 *
 * `fileName` is optional and used only for the by-name refusal; callers that already checked with
 * {@link isRefusedMediaFileName} before probing can omit it.
 */
export function classifyMediaSupport(report: ProbeReport, fileName?: string): MediaSupportVerdict {
    const names = containerNames(report);
    const demuxable = isDemuxableContainer(names);
    const knownUnsupported = isKnownUndemuxableContainer(names);
    const streams = classifyStreams(report);
    const container = { names, demuxable, knownUnsupported };

    if (fileName !== undefined && isRefusedMediaFileName(fileName)) {
        return { tier: "refuse", reason: "not-media", container, streams, unsupportedCodecs: [], target: null };
    }

    // No audio and no video. Either the file is not media, or it is a container holding only
    // subtitles or attachments — nothing the engine could ever play, and nothing a transcode
    // could conjure into existence.
    if (streams.length === 0) {
        return { tier: "refuse", reason: "no-streams", container, streams, unsupportedCodecs: [], target: null };
    }

    const unsupportedCodecs = [
        ...new Set(streams.filter(stream => !stream.decodable).map(stream => stream.codec)),
    ];

    if (unsupportedCodecs.length > 0) {
        // The codec axis wins outright. A container swap would leave the offending bytes exactly
        // where they are, so there is no cheaper path than re-encoding.
        return {
            tier: "reencode",
            reason: "codec-unsupported",
            container,
            streams,
            unsupportedCodecs,
            target: reencodeTarget(streams),
        };
    }

    if (demuxable) {
        return { tier: "accept", reason: "playable", container, streams, unsupportedCodecs: [], target: null };
    }

    const remuxTo = remuxContainerFor(streams);
    if (remuxTo === null) {
        // Every codec decodes, and still nothing we are willing to write can hold them together.
        // Re-encoding is the honest answer; the reason field keeps it from looking like a codec
        // problem to whoever reads the report.
        return {
            tier: "reencode",
            reason: "no-remux-container",
            container,
            streams,
            unsupportedCodecs: [],
            target: reencodeTarget(streams),
        };
    }
    return {
        tier: "remux",
        reason: "container-unsupported",
        container,
        streams,
        unsupportedCodecs: [],
        target: { kind: "remux", container: remuxTo },
    };
}

/**
 * The re-encode instruction for these streams.
 *
 * Both codecs are named unconditionally when the corresponding stream kind is present, including
 * for streams that decode perfectly well. That is not waste: the target container is WebM, and
 * WebM will not carry AAC next to a re-encoded VP9 track, so a partial `-c:a copy` is not
 * available. M3 gets one container and at most two encoders, which is all it needs to build the
 * command line.
 */
function reencodeTarget(streams: readonly ClassifiedStream[]): MediaSupportTarget {
    return {
        kind: "reencode",
        container: TRANSCODE_TARGET.container,
        video: streams.some(stream => stream.kind === "video") ? TRANSCODE_TARGET.video : null,
        audio: streams.some(stream => stream.kind === "audio") ? TRANSCODE_TARGET.audio : null,
    };
}

/**
 * Parse `ffprobe -print_format json` output.
 *
 * Lives here rather than next to the spawn so the malformed-output path is testable without a
 * binary. Returns `null` for anything that is not a JSON object — including the empty `{}` ffprobe
 * prints on failure, which parses fine but says nothing; that becomes a report with no format and
 * no streams, and {@link classifyMediaSupport} refuses it for having no streams.
 */
export function parseProbeOutput(stdout: string): ProbeReport | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed as { format?: unknown; streams?: unknown };
    const report: ProbeReport = {};
    if (typeof record.format === "object" && record.format !== null && !Array.isArray(record.format)) {
        const formatName = (record.format as { format_name?: unknown }).format_name;
        report.format = typeof formatName === "string" ? { format_name: formatName } : {};
    }
    if (Array.isArray(record.streams)) {
        report.streams = record.streams.filter(
            (stream): stream is ProbeStream => typeof stream === "object" && stream !== null,
        );
    }
    return report;
}
