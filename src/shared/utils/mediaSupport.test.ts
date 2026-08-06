import { describe, expect, it } from "vitest";
import {
    classifyMediaSupport,
    containerNames,
    isRefusedMediaFileName,
    parseProbeOutput,
    remuxContainerFor,
    TRANSCODE_TARGET,
    type ProbeReport,
} from "./mediaSupport";

/**
 * The cases below are the measured ground truth, written as the reports ffprobe actually produced
 * for them. The `format_name` strings in particular are copied verbatim from a real run rather
 * than shortened - `mov,mp4,m4a,3gp,3g2,mj2` is what FFmpeg 8 prints for every ISO-BMFF file, and a
 * test that used `"mp4"` would pass against a classifier that could never work on a real file.
 */

function report(formatName: string, streams: ProbeReport["streams"] = []): ProbeReport {
    return { format: { format_name: formatName }, streams };
}

const ISOBMFF = "mov,mp4,m4a,3gp,3g2,mj2";
const MATROSKA = "matroska,webm";

function video(codec: string, index = 0) {
    return { index, codec_type: "video", codec_name: codec };
}

function audio(codec: string, index = 0) {
    return { index, codec_type: "audio", codec_name: codec };
}

describe("classifyMediaSupport / accept", () => {
    it("takes VP9 + Opus in WebM as it stands", () => {
        const verdict = classifyMediaSupport(report(MATROSKA, [video("vp9"), audio("opus", 1)]));
        expect(verdict.tier).toBe("accept");
        expect(verdict.reason).toBe("playable");
        expect(verdict.target).toBeNull();
    });

    it("takes H.264 + AAC in MP4", () => {
        expect(classifyMediaSupport(report(ISOBMFF, [video("h264"), audio("aac", 1)])).tier).toBe("accept");
    });

    it("takes the codecs measured only inside Matroska - MP3, FLAC and PCM", () => {
        for (const codec of ["mp3", "flac", "pcm_s16le", "vorbis"]) {
            expect(classifyMediaSupport(report(MATROSKA, [audio(codec)])).tier).toBe("accept");
        }
    });

    it("does not downgrade an MP4 that also carries a subtitle track", () => {
        // A mov_text track is a codec no decoder is ever asked for. Measured: ffprobe reports it
        // as a third stream with codec_type "subtitle".
        const verdict = classifyMediaSupport(
            report(ISOBMFF, [
                video("h264"),
                audio("aac", 1),
                { index: 2, codec_type: "subtitle", codec_name: "mov_text" },
            ]),
        );
        expect(verdict.tier).toBe("accept");
        // The subtitle stream is gone from the verdict entirely, not merely marked undecodable.
        expect(verdict.streams.map(stream => stream.kind)).toEqual(["video", "audio"]);
    });

    it("does not treat embedded cover art as a video stream", () => {
        // Measured: an MP3 with album art reports a second stream whose codec_type is "video" and
        // whose codec_name is "png". Without the attached_pic guard every tagged MP3 an author
        // owns would be re-encoded.
        const verdict = classifyMediaSupport(
            report("mp3", [
                audio("mp3"),
                { index: 1, codec_type: "video", codec_name: "png", disposition: { attached_pic: 1 } },
            ]),
        );
        expect(verdict.tier).toBe("accept");
        expect(verdict.streams).toHaveLength(1);
        expect(verdict.streams[0].kind).toBe("audio");
    });

    it("still counts a real video stream that happens to carry a disposition bag", () => {
        const verdict = classifyMediaSupport(
            report(ISOBMFF, [{ index: 0, codec_type: "video", codec_name: "h264", disposition: { attached_pic: 0 } }]),
        );
        expect(verdict.tier).toBe("accept");
        expect(verdict.streams).toHaveLength(1);
    });
});

describe("classifyMediaSupport / remux", () => {
    it("sends H.264 in AVI to a container swap, not a re-encode", () => {
        const verdict = classifyMediaSupport(report("avi", [video("h264")]));
        expect(verdict.tier).toBe("remux");
        expect(verdict.reason).toBe("container-unsupported");
        // WebM cannot legally carry H.264 - proposing it would produce a command that fails.
        expect(verdict.target).toEqual({ kind: "remux", container: "mp4" });
    });

    it("sends VP8 + Vorbis in AVI to WebM", () => {
        expect(classifyMediaSupport(report("avi", [video("vp8"), audio("vorbis", 1)])).target)
            .toEqual({ kind: "remux", container: "webm" });
    });

    it("sends H.264 in ASF, FLV, MPEG-PS and MPEG-TS to a container swap", () => {
        for (const container of ["asf", "flv", "mpeg", "mpegts"]) {
            const verdict = classifyMediaSupport(report(container, [video("h264")]));
            expect(verdict.tier, container).toBe("remux");
            expect(verdict.container.knownUnsupported, container).toBe(true);
        }
    });

    it("sends PCM in AIFF to WAV rather than wrapping it in WebM", () => {
        expect(classifyMediaSupport(report("aiff", [audio("pcm_s16le")])).target)
            .toEqual({ kind: "remux", container: "wav" });
    });

    it("re-encodes when every codec decodes but nothing will carry the combination", () => {
        // FLAC alongside video: WebM refuses FLAC, MP4 is not on our allowed list for it, and the
        // audio-only shortcut does not apply. Re-encoding is the honest answer.
        const verdict = classifyMediaSupport(report("avi", [video("h264"), audio("flac", 1)]));
        expect(verdict.tier).toBe("reencode");
        expect(verdict.reason).toBe("no-remux-container");
        // Not a codec problem, and the verdict must not claim it is.
        expect(verdict.unsupportedCodecs).toEqual([]);
    });
});

describe("classifyMediaSupport / reencode", () => {
    it("sends HEVC in MP4 to a re-encode even though the container is fine", () => {
        const verdict = classifyMediaSupport(report(ISOBMFF, [video("hevc")]));
        expect(verdict.tier).toBe("reencode");
        expect(verdict.reason).toBe("codec-unsupported");
        expect(verdict.unsupportedCodecs).toEqual(["hevc"]);
        expect(verdict.target).toEqual({ kind: "reencode", container: "webm", video: "vp9", audio: null });
    });

    it("covers every video codec measured as undecodable", () => {
        for (const codec of ["hevc", "mpeg2video", "mpeg4", "prores", "theora", "wmv2"]) {
            expect(classifyMediaSupport(report(MATROSKA, [video(codec)])).tier, codec).toBe("reencode");
        }
    });

    it("covers every audio codec measured as undecodable", () => {
        for (const codec of ["ac3", "alac", "wmav2"]) {
            const verdict = classifyMediaSupport(report(MATROSKA, [audio(codec)]));
            expect(verdict.tier, codec).toBe("reencode");
            expect(verdict.target, codec)
                .toEqual({ kind: "reencode", container: "webm", video: null, audio: "vorbis" });
        }
    });

    it("re-encodes an unknown codec rather than guessing it plays", () => {
        const verdict = classifyMediaSupport(report(ISOBMFF, [video("some_future_codec")]));
        expect(verdict.tier).toBe("reencode");
        // Unknown, not measured-bad: the distinction is what lets a caller word the message honestly.
        expect(verdict.container.demuxable).toBe(true);
    });

    it("names both encoders when the file has video and audio", () => {
        expect(classifyMediaSupport(report(ISOBMFF, [video("hevc"), audio("aac", 1)])).target)
            .toEqual({ kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" });
    });

    it("re-encodes an undecodable codec even when its container is also undemuxable", () => {
        // The codec axis has to win: -c copy would move the bytes the decoder chokes on, unchanged.
        const verdict = classifyMediaSupport(report("avi", [video("mpeg4")]));
        expect(verdict.tier).toBe("reencode");
        expect(verdict.reason).toBe("codec-unsupported");
    });

    it("never proposes AV1, which decodes but is not a legal target", () => {
        expect(TRANSCODE_TARGET.video).toBe("vp9");
        const verdict = classifyMediaSupport(report(ISOBMFF, [video("hevc")]));
        expect(JSON.stringify(verdict.target)).not.toContain("av1");
    });

    it("accepts AV1 that is already there", () => {
        expect(classifyMediaSupport(report(ISOBMFF, [video("av1")])).tier).toBe("accept");
    });
});

describe("classifyMediaSupport / refuse", () => {
    it("refuses a report with no streams at all", () => {
        const verdict = classifyMediaSupport(report(ISOBMFF, []));
        expect(verdict.tier).toBe("refuse");
        expect(verdict.reason).toBe("no-streams");
        expect(verdict.target).toBeNull();
    });

    it("refuses the empty object ffprobe prints when it cannot read a file", () => {
        expect(classifyMediaSupport({}).tier).toBe("refuse");
    });

    it("refuses a container holding only subtitles", () => {
        const verdict = classifyMediaSupport(
            report(MATROSKA, [{ index: 0, codec_type: "subtitle", codec_name: "ass" }]),
        );
        expect(verdict.tier).toBe("refuse");
        expect(verdict.reason).toBe("no-streams");
    });

    it("refuses playlists, DRM wrappers and MIDI by name, before any probing", () => {
        for (const name of ["list.m3u", "list.M3U8", "x.pls", "song.m4p", "score.mid", "score.midi"]) {
            expect(isRefusedMediaFileName(name), name).toBe(true);
        }
    });

    it("refuses by name even when the probe found a perfectly playable stream", () => {
        // An .m3u whose contents happen to parse is still a playlist, not a media file.
        const verdict = classifyMediaSupport(report(MATROSKA, [audio("opus")]), "/assets/stream.m3u8");
        expect(verdict.tier).toBe("refuse");
        expect(verdict.reason).toBe("not-media");
    });

    it("does not refuse ordinary media names", () => {
        for (const name of ["a.mp4", "a.webm", "a.mp3", "midi-intro.wav", "no-extension"]) {
            expect(isRefusedMediaFileName(name), name).toBe(false);
        }
    });

    it("reads the extension off a full path on either separator", () => {
        expect(isRefusedMediaFileName("D:\\project\\assets\\intro.mid")).toBe(true);
        expect(isRefusedMediaFileName("/home/a/assets/intro.mid")).toBe(true);
        // A directory called ".m3u" with a plain file in it must not poison the file.
        expect(isRefusedMediaFileName("/home/a/.m3u/track.ogg")).toBe(false);
    });
});

describe("containerNames", () => {
    it("splits the multi-valued format_name rather than matching it whole", () => {
        expect(containerNames(report(ISOBMFF))).toEqual(["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]);
        expect(containerNames(report(MATROSKA))).toEqual(["matroska", "webm"]);
    });

    it("matches a single-valued one too", () => {
        expect(containerNames(report("avi"))).toEqual(["avi"]);
    });

    it("tolerates whitespace, case and a missing format block", () => {
        expect(containerNames(report(" MOV , MP4 "))).toEqual(["mov", "mp4"]);
        expect(containerNames({})).toEqual([]);
    });

    it("still recognises ISO-BMFF when FFmpeg adds or drops an alias", () => {
        // FFmpeg 8 appends mj2; older builds did not. Both must classify identically.
        expect(classifyMediaSupport(report("mov,mp4,m4a,3gp,3g2", [video("h264")])).tier).toBe("accept");
        expect(classifyMediaSupport(report(ISOBMFF, [video("h264")])).tier).toBe("accept");
    });
});

describe("remuxContainerFor", () => {
    it("prefers a single audio codec's native container", () => {
        expect(remuxContainerFor([{ index: 0, kind: "audio", codec: "flac", decodable: true }])).toBe("flac");
        expect(remuxContainerFor([{ index: 0, kind: "audio", codec: "mp3", decodable: true }])).toBe("mp3");
        expect(remuxContainerFor([{ index: 0, kind: "audio", codec: "opus", decodable: true }])).toBe("ogg");
    });

    it("returns null when no allowed container can hold the combination", () => {
        expect(remuxContainerFor([
            { index: 0, kind: "video", codec: "h264", decodable: true },
            { index: 1, kind: "audio", codec: "vorbis", decodable: true },
        ])).toBeNull();
    });
});

describe("parseProbeOutput", () => {
    it("reads a real report", () => {
        const parsed = parseProbeOutput(
            JSON.stringify({ format: { format_name: ISOBMFF, duration: "1.0" }, streams: [{ codec_type: "video", codec_name: "h264" }] }),
        );
        expect(parsed?.format?.format_name).toBe(ISOBMFF);
        expect(parsed?.streams).toHaveLength(1);
    });

    it("returns null for output that is not JSON", () => {
        expect(parseProbeOutput("")).toBeNull();
        expect(parseProbeOutput("ffprobe: command not found")).toBeNull();
        expect(parseProbeOutput("[1,2,3]")).toBeNull();
    });

    it("accepts the empty object ffprobe prints on failure, and it classifies as refuse", () => {
        const parsed = parseProbeOutput("{\n\n}");
        expect(parsed).toEqual({});
        expect(classifyMediaSupport(parsed!).tier).toBe("refuse");
    });

    it("drops junk entries instead of trusting the shape", () => {
        const parsed = parseProbeOutput(JSON.stringify({ format: "not an object", streams: [null, 7, { codec_type: "audio", codec_name: "aac" }] }));
        expect(parsed?.streams).toHaveLength(1);
        // No usable container name survives, so the container counts as unrecognised - and an
        // unrecognised container is treated as one that will not demux. That costs a lossless
        // container swap; the opposite default would accept a file that does not play.
        expect(classifyMediaSupport(parsed!).tier).toBe("remux");
    });

    it("treats an unrecognised container as one that will not demux", () => {
        const verdict = classifyMediaSupport(report("some_future_container", [audio("aac")]));
        expect(verdict.tier).toBe("remux");
        // Unrecognised, not measured-bad: a caller wording a message must be able to tell them apart.
        expect(verdict.container.knownUnsupported).toBe(false);
    });
});
