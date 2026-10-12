// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { HeadThumbnail } from "./HeadThumbnail";

/**
 * A framing is normalized to the picture, so it is square only when the picture's pixels say so. The
 * skeleton's Narra is framed `{x .455, y .01, w .38, h .35}` on a 1600 × 1586 sprite: 608 × 555 px.
 * The bake letterboxes that into a square; the thumbnail stretched it, so the editor's avatar was
 * 9.5 % taller than the one the game shows.
 */
function loaded(frame: { x: number; y: number; w: number; h: number }, width: number, height: number) {
    const { container } = render(<HeadThumbnail url="blob:sprite" alt="" frame={frame} className="h-64 w-64" />);
    const image = container.querySelector("img")!;
    Object.defineProperty(image, "naturalWidth", { value: width });
    Object.defineProperty(image, "naturalHeight", { value: height });
    fireEvent.load(image);
    return image;
}

const percent = (value: string) => Number.parseFloat(value);

describe("HeadThumbnail with a framing", () => {
    it("scales both axes alike, so a non-square framing is not stretched", () => {
        const image = loaded({ x: 0.455, y: 0.01, w: 0.38, h: 0.35 }, 1600, 1586);
        const ratio = percent(image.style.width) / percent(image.style.height);
        expect(ratio).toBeCloseTo(1600 / 1586, 6);
        // The long side (608 px wide) spans the frame; the short side is centred in it.
        expect(percent(image.style.width)).toBeCloseTo((1600 / 608) * 100, 3);
        expect(percent(image.style.left)).toBeCloseTo((-728 / 608) * 100, 3);
        expect(percent(image.style.top)).toBeCloseTo((((608 - 555.1) / 2 - 15.86) / 608) * 100, 3);
    });

    it("fills the frame exactly with a framing that is square in the picture's pixels", () => {
        // 0.2 × 1000 = 0.1 × 2000 = 200 px.
        const image = loaded({ x: 0.4, y: 0.05, w: 0.2, h: 0.1 }, 1000, 2000);
        expect(percent(image.style.width)).toBeCloseTo(500, 6);
        expect(percent(image.style.height)).toBeCloseTo(1000, 6);
        expect(percent(image.style.left)).toBeCloseTo(-200, 6);
        expect(percent(image.style.top)).toBeCloseTo(-50, 6);
    });

    it("holds the picture back until its size is known", () => {
        const { container } = render(<HeadThumbnail url="blob:other" alt="" frame={{ x: 0, y: 0, w: 0.5, h: 0.5 }} />);
        const image = container.querySelector("img")!;
        expect(image.className).toContain("opacity-0");
        Object.defineProperty(image, "naturalWidth", { value: 100 });
        Object.defineProperty(image, "naturalHeight", { value: 100 });
        fireEvent.load(image);
        expect(image.className).toContain("opacity-100");
    });
});
