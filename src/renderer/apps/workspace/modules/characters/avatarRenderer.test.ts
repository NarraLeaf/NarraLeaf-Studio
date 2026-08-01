import { afterEach, describe, expect, it } from "vitest";
import { createAvatarRenderer, planAvatarEncode } from "./avatarRenderer";

/**
 * These tests exist because a dialog avatar went out at 256×256 for months and nothing failed.
 *
 * The bake used to resample every crop to a fixed 256 square, so a 1088×1984 sprite — whose head
 * crop is around 478px — was thrown away down to 256 before anything ever displayed it, while the
 * dialog box asks for several hundred device pixels. Nothing in the pipeline noticed, because
 * "produces a PNG" was the only thing anyone asserted. What follows asserts the *size* of it.
 */

describe("planAvatarEncode", () => {
    /** A square-in-pixels crop of `size` px, centred — the shape both crop producers emit. */
    function centredCrop(source: { width: number; height: number }, size: number) {
        return {
            x: (source.width - size) / 2 / source.width,
            y: (source.height - size) / 2 / source.height,
            w: size / source.width,
            h: size / source.height,
        };
    }

    it("bakes a real sprite's head crop at the sprite's own resolution", () => {
        // The measured case: a 1088×1984 sprite crops to roughly 478px of head.
        const source = { width: 1088, height: 1984 };
        const plan = planAvatarEncode(source, centredCrop(source, 478), 1024);

        expect(plan.size).toBe(478);
        expect([plan.dw, plan.dh]).toEqual([plan.sw, plan.sh]);
        // The regression itself, spelled out: this used to be 256.
        expect(plan.size).toBeGreaterThan(256);
    });

    it("never scales a crop up to reach the ceiling", () => {
        // Interpolating a 96px crop up to 1024 would invent nothing but blur and 40× the bytes.
        const source = { width: 200, height: 400 };
        const plan = planAvatarEncode(source, centredCrop(source, 96), 1024);

        expect(plan.size).toBe(96);
        expect(plan.dw).toBe(plan.sw);
    });

    it("copies the crop 1:1 for anything at or under the ceiling", () => {
        for (const size of [16, 100, 255, 256, 257, 478, 1023, 1024]) {
            const source = { width: 4096, height: 4096 };
            const plan = planAvatarEncode(source, centredCrop(source, size), 1024);
            expect({ size, dw: plan.dw, dh: plan.dh }).toEqual({ size, dw: plan.sw, dh: plan.sh });
        }
    });

    it("caps a pathological sprite, because the PNG is version-controlled project content", () => {
        const source = { width: 4000, height: 6000 };
        const plan = planAvatarEncode(source, centredCrop(source, 3800), 1024);

        expect(plan.size).toBe(1024);
        expect(plan.dw).toBeLessThan(plan.sw);
    });

    it("letterboxes a non-square crop instead of squashing it", () => {
        // Kept because the thing that displays a baked avatar is an `nl.image` in a square box with
        // `imageFill.mode: "cover"` — a non-square PNG there is centre-cropped by the widget, which
        // would cut away part of the framing the author chose.
        const source = { width: 1000, height: 1000 };
        const plan = planAvatarEncode(source, { x: 0, y: 0, w: 0.4, h: 0.2 }, 1024);

        expect([plan.sw, plan.sh]).toEqual([400, 200]);
        expect(plan.size).toBe(400);
        expect([plan.dw, plan.dh]).toEqual([400, 200]);
    });

    it("keeps the source rectangle inside the source", () => {
        const plan = planAvatarEncode({ width: 100, height: 100 }, { x: 0.8, y: 0.8, w: 0.5, h: 0.5 }, 1024);

        expect(plan.sx + plan.sw).toBeLessThanOrEqual(100);
        expect(plan.sy + plan.sh).toBeLessThanOrEqual(100);
    });
});

/**
 * A canvas that records what it was made at and what was drawn into it. The suite runs in the
 * `node` environment, so there is no real one; a fake is also the only way to read back the output
 * *dimensions*, which a PNG blob would hide.
 */
class FakeCanvas {
    static created: FakeCanvas[] = [];
    public readonly draws: unknown[][] = [];
    public pixels: { data: Uint8ClampedArray; width: number; height: number } | null = null;

    constructor(public width: number, public height: number) {
        FakeCanvas.created.push(this);
    }

    getContext(): unknown {
        return {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low",
            drawImage: (...args: unknown[]) => {
                this.draws.push(args);
            },
            getImageData: () => this.pixels
                ?? { data: new Uint8ClampedArray(this.width * this.height * 4), width: this.width, height: this.height },
        };
    }

    convertToBlob(): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }> {
        return Promise.resolve({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer });
    }
}

/** A head-up silhouette: head, neck, shoulders — the shape `findHeadCrop` is built to read. */
function silhouette(width: number, height: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    const bands = [
        { from: 20, to: 110, left: 170, right: 230 },
        { from: 110, to: 130, left: 190, right: 210 },
        { from: 130, to: 500, left: 100, right: 300 },
        { from: 500, to: 780, left: 140, right: 260 },
    ];
    for (const band of bands) {
        for (let y = band.from; y < band.to; y++) {
            for (let x = band.left; x < band.right; x++) {
                data[(y * width + x) * 4 + 3] = 255;
            }
        }
    }
    return data;
}

describe("createAvatarRenderer", () => {
    const realCanvas = globalThis.OffscreenCanvas;

    afterEach(() => {
        globalThis.OffscreenCanvas = realCanvas;
        FakeCanvas.created = [];
    });

    function install(sourcePixels?: Uint8ClampedArray, source = { width: 400, height: 800 }): void {
        FakeCanvas.created = [];
        globalThis.OffscreenCanvas = class extends FakeCanvas {
            constructor(width: number, height: number) {
                super(width, height);
                if (sourcePixels && width === source.width && height === source.height) {
                    this.pixels = { data: sourcePixels, width, height };
                }
            }
        } as unknown as typeof OffscreenCanvas;
    }

    function bitmap(width: number, height: number): ImageBitmap {
        return { width, height, close: () => undefined } as unknown as ImageBitmap;
    }

    it("writes the author's crop at source resolution, not at a fixed square", async () => {
        install();
        const render = createAvatarRenderer(async () => bitmap(1088, 1984));
        // 478px of head out of a 1088-wide sprite, the measured real-project case.
        const bytes = await render({
            layers: ["sprite"],
            crop: { x: 0.28, y: 0.05, w: 478 / 1088, h: 478 / 1984 },
            maxSize: 1024,
        });

        expect(bytes).not.toBeNull();
        const [composite, out] = FakeCanvas.created;
        expect([composite.width, composite.height]).toEqual([1088, 1984]);
        // Before this change the output was 256×256 regardless of what went in.
        expect([out.width, out.height]).toEqual([478, 478]);
        // ...and the crop landed at 1:1, which is what "no resample" means.
        expect(out.draws[0].slice(3, 5)).toEqual(out.draws[0].slice(7, 9));
    });

    it("keeps an automatically located head crop at source resolution too", async () => {
        const source = { width: 400, height: 800 };
        install(silhouette(source.width, source.height), source);
        const render = createAvatarRenderer(async () => bitmap(source.width, source.height));
        await render({ layers: ["sprite"], crop: undefined, maxSize: 1024 });

        const out = FakeCanvas.created[FakeCanvas.created.length - 1];
        // The head is ~60×90px, so the padded square lands near 100 — the point is that the bake
        // does not then interpolate it up to 256, which is what it used to do.
        expect(out.width).toBeGreaterThan(80);
        expect(out.width).toBeLessThan(160);
        expect(out.width).toBe(out.height);
    });
});
