import { describe, expect, it } from "vitest";
import {
    ASSET_COMPRESSION_TRACKS,
    DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    DEFAULT_ASSET_QUALITY,
    DELIVERY_SAMPLE_RATE_HZ,
    advancedSeedForTrack,
    assetTrackEnabled,
    audioBitrateKbpsForQuality,
    imageWebpQualityForQuality,
    normalizeAssetCompressionConfiguration,
    readAssetCompressionConfiguration,
    resolveAudioCompression,
    resolveImageCompression,
    resolveVideoCompression,
    videoCrfForQuality,
    type AssetCompressionConfiguration,
} from "./assetCompression";

const ON: AssetCompressionConfiguration = {
    ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    compressImages: true,
    compressAudio: true,
    compressVideo: true,
};

describe("normalizeAssetCompressionConfiguration", () => {
    it("gives a project that never opened the panel every track off, in auto", () => {
        expect(normalizeAssetCompressionConfiguration(undefined))
            .toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
        for (const track of ASSET_COMPRESSION_TRACKS) {
            expect(assetTrackEnabled(DEFAULT_ASSET_COMPRESSION_CONFIGURATION, track)).toBe(false);
        }
    });

    it("only turns a track on for a literal true, and only leaves auto for a literal advanced", () => {
        // A config file hand-edited into nonsense must not be able to turn on a
        // step that cannot be undone, nor move an author onto numbers they never
        // typed.
        for (const value of ["true", 1, {}, null, "AUTO", "Advanced"]) {
            const config = normalizeAssetCompressionConfiguration({
                compressImages: value, compressAudio: value, compressVideo: value,
                imageMode: value, audioMode: value, videoMode: value,
            });
            expect([config.compressImages, config.compressAudio, config.compressVideo])
                .toEqual([false, false, false]);
            expect([config.imageMode, config.audioMode, config.videoMode])
                .toEqual(["auto", "auto", "auto"]);
        }
        expect(normalizeAssetCompressionConfiguration({ audioMode: "advanced" }).audioMode).toBe("advanced");
    });

    it("clamps every number into the range its own encoder accepts", () => {
        expect(normalizeAssetCompressionConfiguration({ imageQuality: 0 }).imageQuality).toBe(1);
        expect(normalizeAssetCompressionConfiguration({ audioQuality: 900 }).audioQuality).toBe(100);
        expect(normalizeAssetCompressionConfiguration({ videoCrf: 2 }).videoCrf).toBe(10);
        expect(normalizeAssetCompressionConfiguration({ videoCrf: 63 }).videoCrf).toBe(55);
        expect(normalizeAssetCompressionConfiguration({ audioBitrateKbps: 4 }).audioBitrateKbps).toBe(8);
        expect(normalizeAssetCompressionConfiguration({ audioBitrateKbps: "nonsense" }).audioBitrateKbps)
            .toBe(DEFAULT_ASSET_COMPRESSION_CONFIGURATION.audioBitrateKbps);
    });

    it("keeps a cap switchable off without dragging it into its own range", () => {
        // Zero is "leave it alone", not "the smallest allowed", so it must survive
        // a clamp whose floor is far above it.
        for (const value of [0, -1, -4000]) {
            expect(normalizeAssetCompressionConfiguration({ imageMaxDimension: value }).imageMaxDimension).toBe(0);
            expect(normalizeAssetCompressionConfiguration({ audioSampleRateHz: value }).audioSampleRateHz).toBe(0);
        }
        expect(normalizeAssetCompressionConfiguration({ imageMaxDimension: 8 }).imageMaxDimension).toBe(16);
        expect(normalizeAssetCompressionConfiguration({ imageMaxDimension: 1920 }).imageMaxDimension).toBe(1920);
    });
});

describe("readAssetCompressionConfiguration", () => {
    it("reads the key the setting lives under", () => {
        expect(readAssetCompressionConfiguration({
            assetCompression: { compressAudio: true, audioMode: "advanced", audioBitrateKbps: 96 },
        })).toEqual({
            ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
            compressAudio: true,
            audioMode: "advanced",
            audioBitrateKbps: 96,
        });
    });

    it("carries an image decision forward from either name the setting used to have", () => {
        // The two older shapes only ever spoke about images, and neither knew
        // about the modes, so both land in auto.
        for (const key of ["assetOptimization", "webOptimization"]) {
            expect(readAssetCompressionConfiguration({ [key]: { lossyImages: true, lossyQuality: 55 } }))
                .toEqual({
                    ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
                    compressImages: true,
                    imageQuality: 55,
                    imageWebpQuality: 55,
                });
        }
    });

    it("prefers the current key when a project carries more than one", () => {
        expect(readAssetCompressionConfiguration({
            assetCompression: { compressImages: false },
            assetOptimization: { lossyImages: true, lossyQuality: 40 },
        })).toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
    });

    it("answers for a project with no app config at all", () => {
        expect(readAssetCompressionConfiguration(undefined)).toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
        expect(readAssetCompressionConfiguration({})).toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
    });
});

describe("what a quality means per track", () => {
    it("runs the right way on every scale", () => {
        // Bitrate rises with quality; CRF falls. Getting one of them backwards
        // produces a build that works and ships the worst file at the top of the
        // slider, which is why this is asserted rather than assumed.
        for (let quality = 2; quality <= 100; quality += 1) {
            expect(audioBitrateKbpsForQuality(quality))
                .toBeGreaterThanOrEqual(audioBitrateKbpsForQuality(quality - 1));
            expect(videoCrfForQuality(quality)).toBeLessThanOrEqual(videoCrfForQuality(quality - 1));
            expect(imageWebpQualityForQuality(quality)).toBeGreaterThan(imageWebpQualityForQuality(quality - 1));
        }
    });

    it("stays inside what the encoders accept, including out-of-range input", () => {
        for (const quality of [-50, 0, 1, 50, 100, 1000, Number.NaN]) {
            const kbps = audioBitrateKbpsForQuality(quality);
            expect(kbps).toBeGreaterThanOrEqual(32);
            expect(kbps).toBeLessThanOrEqual(256);
            expect(kbps % 8).toBe(0);
            const crf = videoCrfForQuality(quality);
            expect(crf).toBeGreaterThanOrEqual(15);
            expect(crf).toBeLessThanOrEqual(50);
            const webp = imageWebpQualityForQuality(quality);
            expect(webp).toBeGreaterThanOrEqual(1);
            expect(webp).toBeLessThanOrEqual(100);
        }
    });

    it("keeps the default generous", () => {
        // The default has to be a quality nobody notices, because it is what
        // ships for an author who turned the switch on and read no further.
        expect(audioBitrateKbpsForQuality(DEFAULT_ASSET_QUALITY)).toBeGreaterThanOrEqual(160);
        expect(videoCrfForQuality(DEFAULT_ASSET_QUALITY)).toBeLessThanOrEqual(30);
    });
});

describe("auto and advanced", () => {
    it("ships the same build in both modes until somebody changes a number", () => {
        // The whole promise of the advanced mode: it reveals what auto was doing
        // rather than replacing it. If a mapping is ever retuned without moving
        // the stored defaults, this is what says so.
        const auto = { ...ON };
        const advanced: AssetCompressionConfiguration = {
            ...ON, imageMode: "advanced", audioMode: "advanced", videoMode: "advanced",
        };
        expect(resolveImageCompression(advanced)).toEqual(resolveImageCompression(auto));
        expect(resolveAudioCompression(advanced)).toEqual(resolveAudioCompression(auto));
        expect(resolveVideoCompression(advanced)).toEqual(resolveVideoCompression(auto));
    });

    it("seeds the advanced fields from whatever quality auto was on", () => {
        const config: AssetCompressionConfiguration = { ...ON, audioQuality: 40, videoQuality: 40, imageQuality: 40 };
        expect(advancedSeedForTrack(config, "audio")).toEqual({
            audioBitrateKbps: audioBitrateKbpsForQuality(40),
            audioSampleRateHz: DELIVERY_SAMPLE_RATE_HZ,
        });
        expect(advancedSeedForTrack(config, "video")).toEqual({ videoCrf: videoCrfForQuality(40) });
        expect(advancedSeedForTrack(config, "images")).toEqual({ imageWebpQuality: 40 });
    });

    it("reads only its own mode's numbers", () => {
        const config: AssetCompressionConfiguration = {
            ...ON,
            audioMode: "advanced", audioQuality: 10, audioBitrateKbps: 96, audioSampleRateHz: 44_100,
            videoMode: "auto", videoQuality: 40, videoCrf: 12,
        };
        expect(resolveAudioCompression(config)).toEqual({
            enabled: true, bitrateKbps: 96, sampleRateHz: 44_100,
        });
        expect(resolveVideoCompression(config)).toEqual({
            enabled: true, crf: videoCrfForQuality(40), maxHeight: null,
        });
    });

    it("offers the caps only in advanced", () => {
        // Auto never resizes and never leaves the delivery rate: a build cannot
        // tell an artist working at twice the stage size from one whose art is
        // that size on purpose.
        const withCaps: AssetCompressionConfiguration = { ...ON, imageMaxDimension: 1920, videoMaxHeight: 720 };
        expect(resolveImageCompression(withCaps).maxDimension).toBeNull();
        expect(resolveVideoCompression(withCaps).maxHeight).toBeNull();
        expect(resolveAudioCompression(withCaps).sampleRateHz).toBe(DELIVERY_SAMPLE_RATE_HZ);

        const advanced: AssetCompressionConfiguration = {
            ...withCaps, imageMode: "advanced", videoMode: "advanced", audioMode: "advanced",
            audioSampleRateHz: 0,
        };
        expect(resolveImageCompression(advanced).maxDimension).toBe(1920);
        expect(resolveVideoCompression(advanced).maxHeight).toBe(720);
        // Zero is the author saying "leave the rate alone", which auto has no way
        // of expressing.
        expect(resolveAudioCompression(advanced).sampleRateHz).toBeNull();
    });
});
