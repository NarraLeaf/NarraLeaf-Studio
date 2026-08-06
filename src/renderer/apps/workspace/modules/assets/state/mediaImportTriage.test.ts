import { describe, expect, it, vi } from "vitest";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { UNDECODABLE_EXTENSIONS } from "@/lib/workspace/services/assets/FileFormatValidator";
import { CONVERTIBLE_IMAGE_EXTENSIONS } from "@shared/types/mediaConvert";
import type { MediaProbeOutcome } from "@shared/types/mediaProbe";
import type { MediaSupportVerdict } from "@shared/utils/mediaSupport";
import { categoryNeedsMediaTriage, planMediaImport } from "./mediaImportTriage";

/**
 * The two tables that name undecodable image formats live on opposite sides of a boundary `shared`
 * is not allowed to cross, so neither can import the other. That is exactly the arrangement that
 * drifts: the last time this pair of tables disagreed, `.opus` and `.apng` became impossible to
 * import at all, and nothing said so until an author tried.
 *
 * Asserted as set equality rather than "one contains the other" on purpose. An extension in the
 * refusal list with no conversion is a dead end the author is offered no way out of; an extension
 * with a conversion but no refusal is a file that imports and then does not display. Both are
 * failures, so neither direction may drift.
 */
describe("convertible image extensions match the refused ones", () => {
    it("names the same set on both sides of the shared/renderer boundary", () => {
        const refused = Object.keys(UNDECODABLE_EXTENSIONS[AssetType.Image] ?? {}).sort();
        expect([...CONVERTIBLE_IMAGE_EXTENSIONS].sort()).toEqual(refused);
    });
});

describe("categoryNeedsMediaTriage", () => {
    it("checks only the sections holding something a player has to decode", () => {
        expect(categoryNeedsMediaTriage(AssetCategory.Image)).toBe(true);
        expect(categoryNeedsMediaTriage(AssetCategory.Media)).toBe(true);
        expect(categoryNeedsMediaTriage(AssetCategory.Font)).toBe(false);
        expect(categoryNeedsMediaTriage(AssetCategory.Data)).toBe(false);
        expect(categoryNeedsMediaTriage(AssetCategory.Other)).toBe(false);
    });
});

function probed(verdict: MediaSupportVerdict, durationUs: number | null = 5_000_000): MediaProbeOutcome {
    return { status: "probed", verdict, durationUs };
}

function verdict(overrides: Partial<MediaSupportVerdict>): MediaSupportVerdict {
    return {
        tier: "accept",
        reason: "playable",
        container: { names: ["mp4"], demuxable: true, knownUnsupported: false },
        streams: [],
        unsupportedCodecs: [],
        target: null,
        ...overrides,
    };
}

describe("planMediaImport", () => {
    it("never probes a file whose name already answers the question", async () => {
        const probe = vi.fn(async () => null);

        const plan = await planMediaImport(["C:/art/logo.tif", "C:/art/logo.png"], probe);

        expect(probe).not.toHaveBeenCalled();
        expect(plan.ready).toEqual(["C:/art/logo.png"]);
        expect(plan.problems).toHaveLength(1);
        expect(plan.problems[0]).toMatchObject({
            group: "lossless",
            target: { kind: "image", container: "png" },
            durationUs: null,
        });
    });

    it("leaves a playable file alone", async () => {
        const plan = await planMediaImport(
            ["C:/media/intro.mp4"],
            async () => probed(verdict({ tier: "accept" })),
        );

        expect(plan.ready).toEqual(["C:/media/intro.mp4"]);
        expect(plan.problems).toEqual([]);
    });

    it("carries the probe's duration into a container swap", async () => {
        const plan = await planMediaImport(
            ["C:/media/clip.avi"],
            async () => probed(verdict({
                tier: "remux",
                reason: "container-unsupported",
                container: { names: ["avi"], demuxable: false, knownUnsupported: true },
                streams: [{ index: 0, kind: "video", codec: "h264", decodable: true }],
                target: { kind: "remux", container: "mp4", audioOnly: false },
            }), 12_000_000),
        );

        expect(plan.problems[0]).toMatchObject({
            group: "lossless",
            durationUs: 12_000_000,
            // Nothing plays out of a container the demuxer will not open, so there is no partial
            // result to offer and the dialog must not suggest importing it as it is.
            partiallyUsable: false,
        });
    });

    it("calls a re-encode partially usable only when something in it already plays", async () => {
        const hevcWithSound = await planMediaImport(
            ["C:/media/phone.mp4"],
            async () => probed(verdict({
                tier: "reencode",
                reason: "codec-unsupported",
                streams: [
                    { index: 0, kind: "video", codec: "hevc", decodable: false },
                    { index: 1, kind: "audio", codec: "aac", decodable: true },
                ],
                unsupportedCodecs: ["hevc"],
                target: { kind: "reencode", container: "webm", video: "vp9", audio: "vorbis" },
            })),
        );
        expect(hevcWithSound.problems[0]).toMatchObject({ group: "lossy", partiallyUsable: true });

        const everythingDead = await planMediaImport(
            ["C:/media/old.mpg"],
            async () => probed(verdict({
                tier: "reencode",
                reason: "codec-unsupported",
                container: { names: ["mpeg"], demuxable: false, knownUnsupported: true },
                streams: [{ index: 0, kind: "video", codec: "mpeg2video", decodable: false }],
                unsupportedCodecs: ["mpeg2video"],
                target: { kind: "reencode", container: "webm", video: "vp9", audio: null },
            })),
        );
        expect(everythingDead.problems[0]).toMatchObject({ group: "lossy", partiallyUsable: false });
    });

    it("separates the two reasons there is nothing to offer", async () => {
        // Refused by name, without a probe: ffprobe resolves the entries inside a playlist, and one
        // of them can be a URL.
        const probe = vi.fn(async () => null);
        const playlist = await planMediaImport(["C:/media/list.m3u8"], probe);
        expect(probe).not.toHaveBeenCalled();
        expect(playlist.problems[0]).toMatchObject({ group: "refused", refusal: "notMedia", target: null });

        const empty = await planMediaImport(
            ["C:/media/subs.mkv"],
            async () => probed(verdict({ tier: "refuse", reason: "no-streams" })),
        );
        expect(empty.problems[0]).toMatchObject({ group: "refused", refusal: "noStreams" });
    });

    /**
     * A machine with no ffprobe imports media it has always imported. Turning an unanswered question
     * into a refusal would break importing entirely wherever the tool is missing.
     */
    it("imports a file whose probe could not answer", async () => {
        for (const outcome of [
            null,
            { status: "unavailable", detail: "not found", searched: [] } as MediaProbeOutcome,
            { status: "failed", reason: "timeout", detail: "timed out" } as MediaProbeOutcome,
        ]) {
            const plan = await planMediaImport(["C:/media/clip.mp4"], async () => outcome);
            expect(plan.ready).toEqual(["C:/media/clip.mp4"]);
            expect(plan.problems).toEqual([]);
        }
    });
});
