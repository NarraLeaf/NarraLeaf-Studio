import { describe, expect, it } from "vitest";
import { findHeadCrop, NormalizedCrop } from "./headCrop";

/** A horizontal slab of opaque pixels, `from` inclusive, `to` exclusive. */
type Band = { from: number; to: number; left: number; right: number };

function sprite(width: number, height: number, bands: Band[]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const band of bands) {
        for (let y = band.from; y < band.to; y++) {
            for (let x = band.left; x < band.right; x++) {
                data[(y * width + x) * 4 + 3] = 255;
            }
        }
    }
    return data;
}

/** Where the crop sits in pixels, which is far easier to reason about than fractions. */
function toPixels(crop: NormalizedCrop, width: number, height: number) {
    return {
        x: crop.x * width,
        y: crop.y * height,
        size: crop.w * width,
        bottom: (crop.y + crop.h) * height,
    };
}

/**
 * A standing character: head, neck, then shoulders flaring into a body. The
 * shoulders are only 2.5x the head here, which is typical and well under the
 * "sudden flare" a naive detector looks for.
 */
const FULL_BODY: Band[] = [
    { from: 10, to: 46, left: 40, right: 60 },   // head
    { from: 46, to: 54, left: 46, right: 54 },   // neck
    { from: 54, to: 180, left: 25, right: 75 },  // shoulders + torso
    { from: 180, to: 290, left: 35, right: 65 }, // legs
];

describe("findHeadCrop", () => {
    it("frames the head of a full-body sprite, not the torso", () => {
        const crop = findHeadCrop(sprite(100, 300, FULL_BODY), 100, 300);
        expect(crop).not.toBeNull();

        const px = toPixels(crop!, 100, 300);
        // The whole head is inside the crop...
        expect(px.y).toBeLessThanOrEqual(10);
        expect(px.bottom).toBeGreaterThanOrEqual(46);
        // ...and the crop stops around the neck rather than running into the body.
        expect(px.bottom).toBeLessThan(80);
        // A head that is 20x36 should not produce a crop the size of the torso.
        expect(px.size).toBeLessThan(60);
        // Horizontally centred on the head, which spans 40..60.
        expect(px.x + px.size / 2).toBeCloseTo(50, 0);
    });

    it("keeps wide hair in frame instead of mistaking it for shoulders", () => {
        // Twintails make the head wider than the shoulders are - the case that
        // defeats any detector keyed on the outline suddenly flaring out.
        const crop = findHeadCrop(sprite(100, 300, [
            { from: 10, to: 46, left: 28, right: 72 },
            { from: 46, to: 54, left: 46, right: 54 },
            { from: 54, to: 180, left: 25, right: 75 },
            { from: 180, to: 290, left: 35, right: 65 },
        ]), 100, 300);
        expect(crop).not.toBeNull();

        const px = toPixels(crop!, 100, 300);
        expect(px.bottom).toBeLessThan(80);
        expect(px.x).toBeLessThanOrEqual(28);
        expect(px.x + px.size).toBeGreaterThanOrEqual(72);
    });

    it("ignores an ahoge above the head", () => {
        const withAhoge = findHeadCrop(sprite(100, 300, [
            { from: 2, to: 10, left: 48, right: 52 }, // hair spike
            ...FULL_BODY,
        ]), 100, 300);
        expect(withAhoge).not.toBeNull();
        // The spike must not read as a tiny head of its own.
        expect(toPixels(withAhoge!, 100, 300).size).toBeGreaterThan(30);
        expect(toPixels(withAhoge!, 100, 300).bottom).toBeGreaterThanOrEqual(46);
    });

    it("reports nothing when the sprite is a face close-up", () => {
        // No neck in frame, so there is nothing to find and top-anchoring is right.
        expect(findHeadCrop(sprite(100, 100, [{ from: 5, to: 95, left: 10, right: 90 }]), 100, 100)).toBeNull();
    });

    it("reports nothing for art on an opaque background", () => {
        const data = new Uint8ClampedArray(100 * 300 * 4).fill(255);
        expect(findHeadCrop(data, 100, 300)).toBeNull();
    });

    it("reports nothing for a figure that only tapers downwards", () => {
        // Narrowing alone is not a neck; without shoulders below it this would
        // otherwise swallow the whole upper half of the image.
        const bands: Band[] = [];
        for (let y = 0; y < 300; y++) {
            const half = Math.round(45 - (y / 300) * 40);
            bands.push({ from: y, to: y + 1, left: 50 - half, right: 50 + half });
        }
        expect(findHeadCrop(sprite(100, 300, bands), 100, 300)).toBeNull();
    });

    it("reports nothing for an empty image", () => {
        expect(findHeadCrop(new Uint8ClampedArray(100 * 300 * 4), 100, 300)).toBeNull();
    });

    it("survives a single-pixel image", () => {
        expect(() => findHeadCrop(new Uint8ClampedArray(4).fill(255), 1, 1)).not.toThrow();
    });

    /**
     * Row extents measured from the two demo sprites at analysis resolution.
     * Both widen gradually from hair to shoulders to arms, which is what the
     * synthetic fixtures above cannot capture.
     */
    const REAL_SPRITES: Record<string, { extents: number[]; head: [number, number] }> = {
        // Bob cut and a beret; arms spread, so the widest row is the hands.
        YouKi: {
            extents: [6, 10, 12, 17, 22, 24, 26, 24, 27, 29, 30, 32, 34, 34, 36, 36, 38, 38, 38, 38, 39, 39, 38, 37, 37, 38, 40, 45, 43, 44, 51, 47, 48, 49, 49, 47, 50, 47, 47, 46, 45, 40, 38, 34, 32, 31, 29, 32, 34, 36, 36, 38, 38, 39, 40, 41, 41, 42, 43, 43, 45, 45, 45, 46, 46, 45, 44, 44, 45, 44, 42, 40, 40, 40],
            head: [0, 46], // rows, relative to the array
        },
        // Hair down past the waist, so the outline never stops widening.
        Nattou: {
            extents: [5, 7, 8, 2, 3, 3, 3, 16, 17, 19, 21, 24, 26, 27, 29, 31, 31, 33, 33, 35, 35, 35, 37, 37, 37, 38, 40, 44, 43, 39, 40, 41, 42, 43, 43, 45, 40, 40, 39, 39, 38, 37, 37, 35, 35, 35, 37, 37, 37, 37, 37, 38, 38, 38, 39, 40, 40, 40, 40, 41, 42, 42, 43, 43, 43, 45, 45, 45, 46, 46, 47, 48, 48, 50, 50],
            head: [0, 43],
        },
    };

    for (const [name, { extents, head }] of Object.entries(REAL_SPRITES)) {
        it(`finds the neck on the ${name} sprite`, () => {
            // Rebuild the silhouette from the measured extents, centred, and pad
            // the rest of the body out at the widest reach so the search window
            // and the "shoulders below" check see a realistic figure.
            const width = 121;
            const height = 220;
            const bands: Band[] = extents.map((extent, y) => ({
                from: y,
                to: y + 1,
                left: Math.round((width - extent) / 2),
                right: Math.round((width + extent) / 2),
            }));
            for (let y = extents.length; y < height; y++) {
                bands.push({ from: y, to: y + 1, left: 10, right: 111 });
            }

            const crop = findHeadCrop(sprite(width, height, bands), width, height);
            expect(crop).not.toBeNull();

            const px = toPixels(crop!, width, height);
            // The crop ends at the neck, give or take the padding - nowhere near
            // the torso, which is where the old flare-based detector landed.
            expect(px.bottom).toBeGreaterThanOrEqual(head[1]);
            expect(px.bottom).toBeLessThan(head[1] + 30);
            // Roughly head-sized: the previous implementation returned ~106 here.
            expect(px.size).toBeLessThan(70);
        });
    }
});
