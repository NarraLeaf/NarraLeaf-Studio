import { describe, expect, it } from "vitest";
import { foldLegacyImageProps } from "./legacyImageProps";

/**
 * What the fold has to preserve is a *rendering*, not a prop bag.
 *
 * Every case below was answered at read time before this existed, by a translation that ran on every
 * paint. The one thing that must not change is what an author sees on the page, so each test states
 * the picture that was being drawn and asserts the fold now writes it down.
 *
 * Only `assetId` is present on any project on this machine - as a real id on the ones that draw
 * something, and as a leftover `null` on the rest. `imageUrl`, `objectFit` and `imageOpacity` are
 * transcribed from the reading that was deleted rather than from a corpus; they belong to documents
 * older than anything here, and getting them wrong would be silent.
 */
describe("foldLegacyImageProps", () => {
    it("leaves an element that never carried the old shape alone", () => {
        expect(foldLegacyImageProps({ fillType: "image", imageFill: { mode: "cover", assetId: "a" } })).toBeNull();
        expect(foldLegacyImageProps(undefined)).toBeNull();
    });

    /** The shipped template's title-screen key art: a bare id and nothing else naming the picture. */
    it("turns a bare id into the fill that draws it", () => {
        expect(foldLegacyImageProps({ assetId: "art-1", clipContent: true })).toEqual({
            clipContent: true,
            fillType: "image",
            imageFill: { mode: "cover", assetId: "art-1" },
        });
    });

    it("reads the old fit, and falls back to cover rather than moving the picture", () => {
        const mode = (objectFit: unknown) =>
            (foldLegacyImageProps({ assetId: "art-1", objectFit }) as { imageFill: { mode: string } }).imageFill.mode;

        expect(mode("fill")).toBe("stretch");
        expect(mode("contain")).toBe("contain");
        expect(mode("cover")).toBe("cover");
        // Neither absent nor unrecognised is a reason to re-fit an image an author already framed.
        expect(mode(undefined)).toBe("cover");
        expect(mode("scale-down")).toBe("cover");
    });

    it("keeps a crop the author placed", () => {
        const cropPlacement = { leftPct: 10, topPct: 20, widthPct: 50, heightPct: 40 };
        expect(foldLegacyImageProps({ assetId: "art-1", imageFill: { mode: "crop", assetId: null, cropPlacement } }))
            .toEqual({
                fillType: "image",
                imageFill: { mode: "cover", assetId: "art-1", cropPlacement },
            });
    });

    /**
     * The other half of the template: an element carrying both spellings of the same id. The current
     * one wins and the old key is only dropped - and dropping it is the point, because an asset id
     * left on props is a reference the build resolves and the shipped game preloads.
     */
    it("drops the old key without touching a picture the current shape already names", () => {
        expect(foldLegacyImageProps({
            assetId: "stale-1",
            fillType: "image",
            imageFill: { mode: "contain", assetId: "art-1" },
        })).toEqual({
            fillType: "image",
            imageFill: { mode: "contain", assetId: "art-1" },
        });
    });

    it("lets a background image win the same way", () => {
        expect(foldLegacyImageProps({ assetId: "stale-1", backgroundImage: "https://example.test/a.png" }))
            .toEqual({ backgroundImage: "https://example.test/a.png" });
    });

    it("drops a placeholder that names nothing", () => {
        expect(foldLegacyImageProps({ assetId: null, fillType: "image" })).toEqual({ fillType: "image" });
        expect(foldLegacyImageProps({ assetId: "   " })).toEqual({});
    });

    it("carries a raw address into the background image", () => {
        expect(foldLegacyImageProps({ imageUrl: " https://example.test/a.png " })).toEqual({
            fillType: "image",
            backgroundImage: "https://example.test/a.png",
        });
    });

    it("carries the old opacity, unless the current one was set", () => {
        expect(foldLegacyImageProps({ assetId: "art-1", imageOpacity: 0.4 })).toMatchObject({ fillOpacity: 0.4 });
        expect(foldLegacyImageProps({ assetId: "art-1", imageOpacity: 5 })).toMatchObject({ fillOpacity: 1 });
        expect(foldLegacyImageProps({ assetId: "art-1", imageOpacity: 0.4, fillOpacity: 1 }))
            .toMatchObject({ fillOpacity: 1 });
        expect(foldLegacyImageProps({ assetId: "art-1", imageOpacity: Number.NaN }))
            .not.toHaveProperty("fillOpacity");
    });
});
