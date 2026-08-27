import { describe, expect, it } from "vitest";
import {
    DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    audioBitrateKbpsForQuality,
    videoCrfForQuality,
    type AssetCompressionConfiguration,
} from "@shared/types/assetCompression";
import type { ProbeReport } from "@shared/utils/mediaSupport";
import { assetMediaWorthKeeping, planAssetMediaCompression } from "./assetMediaCompression";

const ALL_ON: AssetCompressionConfiguration = {
    ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    compressImages: true,
    compressAudio: true,
    compressVideo: true,
};

function audioReport(codec: string, sampleRate?: string): ProbeReport {
    return {
        streams: [{
            index: 0,
            codec_type: "audio",
            codec_name: codec,
            ...(sampleRate ? { sample_rate: sampleRate } : {}),
        }],
    };
}

function videoReport(codec = "h264", tags?: Record<string, string>): ProbeReport {
    return {
        streams: [
            { index: 0, codec_type: "video", codec_name: codec, ...(tags ? { tags } : {}) },
            { index: 1, codec_type: "audio", codec_name: "aac" },
        ],
    };
}

function candidate(over: Partial<Parameters<typeof planAssetMediaCompression>[0]> = {}) {
    return {
        manifestKey: "1e0f0e3a-0000-4000-8000-000000000000",
        assetType: "audio",
        byteLength: 4 * 1024 * 1024,
        report: audioReport("pcm_s16le"),
        ...over,
    };
}

describe("planAssetMediaCompression", () => {
    it("leaves everything alone while the switches are off", () => {
        expect(planAssetMediaCompression(candidate(), DEFAULT_ASSET_COMPRESSION_CONFIGURATION))
            .toEqual({ action: "skip", reason: "not-enabled" });
        expect(planAssetMediaCompression(
            candidate({ assetType: "video", report: videoReport() }),
            DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
        )).toEqual({ action: "skip", reason: "not-enabled" });
    });

    it("compresses each track under its own switch", () => {
        // The point of the split: an author whose artwork must stay exact can
        // still ship compressed voice.
        const audioOnly: AssetCompressionConfiguration = { ...ALL_ON, compressVideo: false };
        expect(planAssetMediaCompression(candidate(), audioOnly).action).toBe("audio");
        expect(planAssetMediaCompression(candidate({ assetType: "video", report: videoReport() }), audioOnly))
            .toEqual({ action: "skip", reason: "not-enabled" });
    });

    it("reads the track from the streams rather than from the asset type", () => {
        // A file filed as video that holds nothing but a voice track answers to
        // the audio switch, and the other way round.
        const videoOnly: AssetCompressionConfiguration = { ...ALL_ON, compressAudio: false };
        expect(planAssetMediaCompression(
            candidate({ assetType: "video", report: audioReport("mp3") }),
            videoOnly,
        )).toEqual({ action: "skip", reason: "not-enabled" });
        expect(planAssetMediaCompression(
            candidate({ assetType: "audio", report: videoReport() }),
            videoOnly,
        ).action).toBe("video");
    });

    it("does not mistake album art for a video stream", () => {
        // An MP3 with a cover reports a second stream whose codec_type is video.
        // Treating it as one would send every tagged track in a music folder
        // through a VP9 encode.
        const withCover: ProbeReport = {
            streams: [
                { index: 0, codec_type: "audio", codec_name: "mp3" },
                { index: 1, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
            ],
        };
        expect(planAssetMediaCompression(candidate({ report: withCover }), ALL_ON).action).toBe("audio");
    });

    it("refuses a video that carries alpha", () => {
        // Encoding it as VP9 profile 0 succeeds, reports nothing, and ships a
        // transparent effect clip as a black rectangle.
        expect(planAssetMediaCompression(
            candidate({ assetType: "video", report: videoReport("vp9", { alpha_mode: "1" }) }),
            ALL_ON,
        )).toEqual({ action: "skip", reason: "alpha" });
    });

    it("skips bundle members and everything that is not sound or picture", () => {
        expect(planAssetMediaCompression(candidate({ assetType: "model" }), ALL_ON))
            .toEqual({ action: "skip", reason: "bundle-member" });
        expect(planAssetMediaCompression(candidate({ manifestKey: "an-id/textures/body.png" }), ALL_ON))
            .toEqual({ action: "skip", reason: "bundle-member" });
        expect(planAssetMediaCompression(candidate({ assetType: undefined }), ALL_ON))
            .toEqual({ action: "skip", reason: "bundle-member" });
        expect(planAssetMediaCompression(candidate({ assetType: "image" }), ALL_ON))
            .toEqual({ action: "skip", reason: "unsupported" });
    });

    it("skips a file too small to pay for its own process", () => {
        expect(planAssetMediaCompression(candidate({ byteLength: 4096 }), ALL_ON))
            .toEqual({ action: "skip", reason: "too-small" });
    });

    it("skips a file with nothing decodable in it", () => {
        expect(planAssetMediaCompression(candidate({ report: {} }), ALL_ON))
            .toEqual({ action: "skip", reason: "no-streams" });
    });

    it("marks a lossless source as one, and everything else as already lossy", () => {
        for (const codec of ["pcm_s16le", "pcm_f32le", "flac", "alac"]) {
            expect(planAssetMediaCompression(candidate({ report: audioReport(codec) }), ALL_ON)).toEqual({
                action: "audio",
                bitrateKbps: audioBitrateKbpsForQuality(82),
                lossySource: false,
                sampleRateHz: null,
            });
        }
        for (const codec of ["mp3", "aac", "vorbis", "opus", "something-nobody-measured"]) {
            expect(planAssetMediaCompression(candidate({ report: audioReport(codec) }), ALL_ON))
                .toMatchObject({ action: "audio", lossySource: true });
        }
    });

    it("caps a delivery copy at 48 kHz and never lifts one to it", () => {
        // Resampling up would spend the same bitrate describing a band the source
        // never had, which is the same mistake with the arrow reversed.
        for (const rate of ["96000", "88200", "192000"]) {
            expect(planAssetMediaCompression(candidate({ report: audioReport("flac", rate) }), ALL_ON))
                .toMatchObject({ sampleRateHz: 48_000 });
        }
        for (const rate of ["48000", "44100", "22050", undefined]) {
            expect(planAssetMediaCompression(candidate({ report: audioReport("flac", rate) }), ALL_ON))
                .toMatchObject({ sampleRateHz: null });
        }
    });

    it("carries the authored quality through to the encoder settings", () => {
        const config: AssetCompressionConfiguration = { ...ALL_ON, audioQuality: 40, videoQuality: 40 };
        expect(planAssetMediaCompression(candidate(), config))
            .toMatchObject({ action: "audio", bitrateKbps: audioBitrateKbpsForQuality(40) });
        expect(planAssetMediaCompression(candidate({ assetType: "video", report: videoReport() }), config))
            .toMatchObject({ action: "video", crf: videoCrfForQuality(40) });
    });
});

describe("assetMediaWorthKeeping", () => {
    it("keeps any real reduction from a lossless source", () => {
        expect(assetMediaWorthKeeping(100_000, 60_000, false)).toBe(true);
        expect(assetMediaWorthKeeping(100_000, 98_000, false)).toBe(true);
    });

    it("makes an already-lossy source clear a much higher bar", () => {
        // A 12% saving is not worth a second generation of loss; a 40% one is.
        expect(assetMediaWorthKeeping(100_000, 88_000, true)).toBe(false);
        expect(assetMediaWorthKeeping(100_000, 60_000, true)).toBe(true);
    });

    it("throws away a result that is not smaller at all", () => {
        expect(assetMediaWorthKeeping(100_000, 100_000, false)).toBe(false);
        expect(assetMediaWorthKeeping(100_000, 120_000, false)).toBe(false);
        expect(assetMediaWorthKeeping(100_000, 0, false)).toBe(false);
    });
});
