import { describe, expect, it } from "vitest";
import {
    DEFAULT_LETTERBOX_CONFIGURATION,
    LETTERBOX_FILL_MODES,
    letterboxAssetIds,
    normalizeLetterboxConfiguration,
} from "./letterbox";

const PICTURE = "6f0e8f7c-1d2b-4c3a-9e8f-7a6b5c4d3e2f";

describe("normalizeLetterboxConfiguration", () => {
    it("reads a project that never opened the setting as black bars and no picture", () => {
        expect(normalizeLetterboxConfiguration(undefined)).toEqual(DEFAULT_LETTERBOX_CONFIGURATION);
        expect(normalizeLetterboxConfiguration({})).toEqual({ color: "#000000", image: null });
    });

    it("keeps an authored colour and picture", () => {
        expect(normalizeLetterboxConfiguration({
            color: "#1a2b3c",
            image: { assetId: PICTURE, fillMode: "tile" },
        })).toEqual({ color: "#1A2B3C", image: { assetId: PICTURE, fillMode: "tile" } });
    });

    it("reads a colour that is not opaque hex as black, since nothing behind the bars could show through", () => {
        for (const color of ["#00000080", "red", "rgb(0, 0, 0)", "", 12]) {
            expect(normalizeLetterboxConfiguration({ color }).color).toBe("#000000");
        }
    });

    it("keeps the picture under an unknown fill mode rather than dropping it", () => {
        expect(normalizeLetterboxConfiguration({ image: { assetId: PICTURE, fillMode: "mirror" } }).image)
            .toEqual({ assetId: PICTURE, fillMode: "cover" });
    });

    it("has no contain: a picture of the design's shape would contain to exactly the stage and show nowhere", () => {
        expect(LETTERBOX_FILL_MODES).not.toContain("contain");
        // A `contain` written by hand falls back like any other unknown mode, to a mode that fills.
        expect(normalizeLetterboxConfiguration({ image: { assetId: PICTURE, fillMode: "contain" } }).image?.fillMode)
            .toBe("cover");
    });

    it("reads an image with no asset as no image", () => {
        expect(normalizeLetterboxConfiguration({ image: { assetId: "  ", fillMode: "cover" } }).image).toBeNull();
        expect(normalizeLetterboxConfiguration({ image: "picture.png" }).image).toBeNull();
    });
});

describe("letterboxAssetIds", () => {
    it("names the picture, and nothing when there is none", () => {
        expect(letterboxAssetIds({ image: { assetId: PICTURE, fillMode: "cover" } })).toEqual([PICTURE]);
        expect(letterboxAssetIds({ color: "#202020" })).toEqual([]);
        expect(letterboxAssetIds(undefined)).toEqual([]);
    });
});
