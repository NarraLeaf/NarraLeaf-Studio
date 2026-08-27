import { describe, expect, it } from "vitest";
import {
    ASSET_COMPRESSION_TRACKS,
    DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
    DEFAULT_ASSET_QUALITY,
    assetTrackCompression,
    audioBitrateKbpsForQuality,
    normalizeAssetCompressionConfiguration,
    readAssetCompressionConfiguration,
    videoCrfForQuality,
} from "./assetCompression";

describe("normalizeAssetCompressionConfiguration", () => {
    it("gives a project that never opened the panel every track off", () => {
        expect(normalizeAssetCompressionConfiguration(undefined))
            .toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
        for (const track of ASSET_COMPRESSION_TRACKS) {
            expect(assetTrackCompression(DEFAULT_ASSET_COMPRESSION_CONFIGURATION, track).enabled).toBe(false);
        }
    });

    it("only turns a track on for a literal true", () => {
        // A config file hand-edited into nonsense must not be able to turn on a
        // step that cannot be undone.
        for (const value of ["true", 1, {}, null]) {
            const config = normalizeAssetCompressionConfiguration({
                compressImages: value,
                compressAudio: value,
                compressVideo: value,
            });
            expect([config.compressImages, config.compressAudio, config.compressVideo])
                .toEqual([false, false, false]);
        }
    });

    it("clamps every quality into the range the panel offers", () => {
        expect(normalizeAssetCompressionConfiguration({ imageQuality: 0 }).imageQuality).toBe(1);
        expect(normalizeAssetCompressionConfiguration({ audioQuality: 900 }).audioQuality).toBe(100);
        expect(normalizeAssetCompressionConfiguration({ videoQuality: 70.9 }).videoQuality).toBe(70);
        expect(normalizeAssetCompressionConfiguration({ audioQuality: "nonsense" }).audioQuality)
            .toBe(DEFAULT_ASSET_QUALITY);
    });
});

describe("readAssetCompressionConfiguration", () => {
    it("reads the key the setting lives under", () => {
        expect(readAssetCompressionConfiguration({
            assetCompression: { compressAudio: true, audioQuality: 60 },
        })).toEqual({ ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION, compressAudio: true, audioQuality: 60 });
    });

    it("carries an image decision forward from either name the setting used to have", () => {
        // The two older shapes only ever spoke about images. A project that said
        // its artwork could afford lossy WebP keeps saying so; it never said
        // anything about its audio, so its audio stays off.
        for (const key of ["assetOptimization", "webOptimization"]) {
            expect(readAssetCompressionConfiguration({ [key]: { lossyImages: true, lossyQuality: 55 } }))
                .toEqual({
                    ...DEFAULT_ASSET_COMPRESSION_CONFIGURATION,
                    compressImages: true,
                    imageQuality: 55,
                });
        }
    });

    it("prefers the current key when a project carries more than one", () => {
        expect(readAssetCompressionConfiguration({
            assetCompression: { compressImages: false, imageQuality: 82 },
            assetOptimization: { lossyImages: true, lossyQuality: 40 },
            webOptimization: { lossyImages: true, lossyQuality: 30 },
        })).toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
    });

    it("answers for a project with no app config at all", () => {
        expect(readAssetCompressionConfiguration(undefined)).toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
        expect(readAssetCompressionConfiguration({})).toEqual(DEFAULT_ASSET_COMPRESSION_CONFIGURATION);
    });
});

describe("what a quality means per track", () => {
    it("runs the right way on both scales", () => {
        // Bitrate rises with quality; CRF falls. Getting one of them backwards
        // produces a build that works and ships the worst file at the top of the
        // slider, which is why this is asserted rather than assumed.
        for (let quality = 2; quality <= 100; quality += 1) {
            expect(audioBitrateKbpsForQuality(quality))
                .toBeGreaterThanOrEqual(audioBitrateKbpsForQuality(quality - 1));
            expect(videoCrfForQuality(quality)).toBeLessThanOrEqual(videoCrfForQuality(quality - 1));
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
        }
    });

    it("keeps the default generous", () => {
        // The default has to be a quality nobody notices, because it is what
        // ships for an author who turned the switch on and read no further.
        expect(audioBitrateKbpsForQuality(DEFAULT_ASSET_QUALITY)).toBeGreaterThanOrEqual(160);
        expect(videoCrfForQuality(DEFAULT_ASSET_QUALITY)).toBeLessThanOrEqual(30);
    });
});
