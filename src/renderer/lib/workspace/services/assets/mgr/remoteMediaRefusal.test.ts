import { describe, expect, it } from "vitest";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";
import { classifyMediaSupport, type ProbeReport } from "@shared/utils/mediaSupport";
import { remoteMediaRefusal } from "./RemoteAssetsManager";

/**
 * Which remote media is let in, and which is turned away at the door.
 *
 * A remote asset that needs converting is a dead end: `replaceAssetContent` refuses a remote source,
 * because converted bytes are not what the URL served and the record would go on saying they were.
 * The ruling is that such a file must not become an asset in the first place.
 *
 * The verdicts here are produced by `classifyMediaSupport` from real ffprobe report shapes rather
 * than hand-written, so a change to the support tables shows up here as a changed answer instead of
 * as a fixture that quietly stopped describing anything.
 */

function probed(report: ProbeReport): MediaProbeOutcome {
    return { status: "probed", verdict: classifyMediaSupport(report), durationUs: 2_000_000 };
}

function report(format: string, streams: ProbeReport["streams"]): ProbeReport {
    return { format: { format_name: format, duration: "2.0" }, streams };
}

describe("remoteMediaRefusal", () => {
    it("lets through a file that plays as it is", () => {
        const outcome = probed(report("mov,mp4,m4a,3gp,3g2,mj2", [
            { index: 0, codec_type: "video", codec_name: "h264" },
            { index: 1, codec_type: "audio", codec_name: "aac" },
        ]));
        expect(remoteMediaRefusal(outcome)).toBeNull();
    });

    it("refuses an mp4 whose codec does not decode, and names the codec", () => {
        // The case no file name can catch: the container, the extension and the magic bytes are all
        // exactly those of a file that plays.
        const outcome = probed(report("mov,mp4,m4a,3gp,3g2,mj2", [
            { index: 0, codec_type: "video", codec_name: "hevc" },
            { index: 1, codec_type: "audio", codec_name: "aac" },
        ]));
        const refusal = remoteMediaRefusal(outcome);
        expect(refusal).toContain("hevc");
        expect(refusal).toContain("NarraLeaf cannot play");
        // The instruction has to be one the author can follow: converting in place is not offered.
        expect(refusal).toContain("import that instead");
    });

    it("refuses a container that will not open, and names the container", () => {
        const outcome = probed(report("avi", [
            { index: 0, codec_type: "video", codec_name: "h264" },
        ]));
        const refusal = remoteMediaRefusal(outcome);
        expect(refusal).toContain("avi");
    });

    it("refuses a file with nothing playable in it", () => {
        const outcome = probed(report("mov,mp4,m4a,3gp,3g2,mj2", []));
        expect(remoteMediaRefusal(outcome)).toContain("no sound or picture");
    });

    it("does not refuse when the probe never answered", () => {
        // Every arm of this is a question that went unanswered, and spending one as a verdict would
        // make importing a URL impossible on a host that merely lacks ffprobe.
        expect(remoteMediaRefusal(null)).toBeNull();
        expect(remoteMediaRefusal({
            status: "unavailable",
            detail: "no ffprobe here",
            searched: ["/nowhere"],
        })).toBeNull();
        expect(remoteMediaRefusal({
            status: "failed",
            reason: "timeout",
            detail: "ffprobe did not finish",
        })).toBeNull();
    });

    it("does not refuse an mp3 for its cover art", () => {
        // The attached picture reports codec_type "video" and would classify as a re-encode without
        // the disposition guard. Every tagged file in an author's music folder is in this shape, so
        // getting it wrong would refuse most of what they own.
        const outcome = probed(report("mp3", [
            { index: 0, codec_type: "audio", codec_name: "mp3" },
            { index: 1, codec_type: "video", codec_name: "png", disposition: { attached_pic: 1 } },
        ]));
        expect(remoteMediaRefusal(outcome)).toBeNull();
    });
});
