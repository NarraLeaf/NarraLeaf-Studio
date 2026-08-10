import { describe, expect, it } from "vitest";
import { mediaConvertTargetExtension } from "./mediaConvert";

/**
 * The extension is the media type on iOS, so these are playability assertions rather than naming
 * ones. The shell's scheme handler types `.mp4` as `video/mp4` and `.m4a` as `audio/mp4`, and
 * WebKit does not sniff its way out of a wrong declaration the way Chromium does.
 */
describe("mediaConvertTargetExtension: audio-only MP4 is written .m4a", () => {
    it("names a re-encode to MP4 with no video track .m4a", () => {
        expect(mediaConvertTargetExtension({ kind: "reencode", container: "mp4", video: null, audio: "aac" }))
            .toBe("m4a");
    });

    it("names a REMUX to MP4 with no video track .m4a", () => {
        // The case this test exists for: a remux target carries no stream list, so before
        // `audioOnly` it could not tell an audio-only MP4 from a video one and emitted `.mp4`.
        // Reachable with two AAC tracks and no video inside a container Chromium cannot demux.
        expect(mediaConvertTargetExtension({ kind: "remux", container: "mp4", audioOnly: true }))
            .toBe("m4a");
    });

    it("leaves an MP4 that carries video alone, on both routes", () => {
        expect(mediaConvertTargetExtension({ kind: "remux", container: "mp4", audioOnly: false }))
            .toBe("mp4");
        expect(mediaConvertTargetExtension({ kind: "reencode", container: "mp4", video: "vp9", audio: "aac" }))
            .toBe("mp4");
    });

    it("does not rewrite containers that are not MP4", () => {
        expect(mediaConvertTargetExtension({ kind: "remux", container: "wav", audioOnly: true })).toBe("wav");
        expect(mediaConvertTargetExtension({ kind: "remux", container: "webm", audioOnly: false })).toBe("webm");
        expect(mediaConvertTargetExtension({ kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" }))
            .toBe("webm");
    });
});
