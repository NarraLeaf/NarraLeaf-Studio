import zlib from "zlib";
import { describe, expect, it } from "vitest";
import type { Layer, Psd } from "ag-psd";
import { decodePngToRgba } from "@shared/utils/pngOpaque";
import { bakeLayer, bakeLayers, describePsd, indexLayers } from "./bakePsdLayers";

const deflate = (bytes: Uint8Array) => new Uint8Array(zlib.deflateSync(bytes));
const inflate = (bytes: Uint8Array) => new Uint8Array(zlib.inflateSync(bytes));

/** A 2×2 solid-red layer, half transparent on its second row. */
function redSquare(): { width: number; height: number; data: Uint8Array } {
    return {
        width: 2,
        height: 2,
        data: new Uint8Array([
            255, 0, 0, 255, 255, 0, 0, 255,
            255, 0, 0, 128, 255, 0, 0, 128,
        ]),
    };
}

describe("describePsd", () => {
    it("keeps the tree's shape and gives every node its path", () => {
        const psd = {
            width: 4, height: 4,
            children: [
                { name: "Body", left: 0, top: 0, right: 2, bottom: 2 },
                { name: "Mood", children: [{ name: "Happy", left: 1, top: 1, right: 3, bottom: 3, blendMode: "multiply" }] },
            ],
        } as unknown as Psd;

        const described = describePsd(psd, "sheet.psd");
        expect(described).toMatchObject({ width: 4, height: 4, fileName: "sheet.psd" });
        expect(described.layers[0]).toMatchObject({ path: ["Body"], bounds: { left: 0, top: 0, right: 2, bottom: 2 } });
        // A group has children and no bounds; its leaf carries the full path and the blend mode.
        expect(described.layers[1].bounds).toBeUndefined();
        expect(described.layers[1].children?.[0]).toMatchObject({ path: ["Mood", "Happy"], blendMode: "multiply" });
    });
});

describe("indexLayers", () => {
    it("addresses drawable layers by joined path and skips the groups themselves", () => {
        const psd = {
            width: 1, height: 1,
            children: [{ name: "Mood", children: [{ name: "Happy" }, { name: "Angry" }] }],
        } as unknown as Psd;
        expect([...indexLayers(psd).keys()]).toEqual(["Mood/Happy", "Mood/Angry"]);
    });
});

describe("bakeLayer", () => {
    it("places a cropped layer at its document position on a transparent canvas", async () => {
        const layer = { name: "Body", left: 1, top: 1, imageData: redSquare(), opacity: 1 } as unknown as Layer;
        const png = await bakeLayer(layer, { width: 4, height: 4 }, deflate);
        const decoded = decodePngToRgba(png, inflate);

        expect(decoded).toMatchObject({ width: 4, height: 4, hadAlpha: true });
        const at = (x: number, y: number) => [...decoded.rgba.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
        // Everything outside the layer's own bounds stays fully transparent...
        expect(at(0, 0)).toEqual([0, 0, 0, 0]);
        expect(at(3, 3)).toEqual([0, 0, 0, 0]);
        // ...and the layer sits at (1,1), not at the origin.
        expect(at(1, 1)).toEqual([255, 0, 0, 255]);
        expect(at(2, 2)).toEqual([255, 0, 0, 128]);
    });

    it("multiplies layer opacity into alpha, because the engine has nowhere else to keep it", async () => {
        const layer = { name: "Body", left: 0, top: 0, imageData: redSquare(), opacity: 0.5 } as unknown as Layer;
        const decoded = decodePngToRgba(await bakeLayer(layer, { width: 2, height: 2 }, deflate), inflate);
        expect(decoded.rgba[3]).toBe(128);
        expect(decoded.rgba[2 * 4 * 1 + 3]).toBe(64);
    });

    it("clips a layer that hangs off the canvas rather than wrapping it", async () => {
        const layer = { name: "Body", left: 3, top: 3, imageData: redSquare(), opacity: 1 } as unknown as Layer;
        const decoded = decodePngToRgba(await bakeLayer(layer, { width: 4, height: 4 }, deflate), inflate);
        const at = (x: number, y: number) => [...decoded.rgba.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
        expect(at(3, 3)).toEqual([255, 0, 0, 255]);
        // The rest of the 2×2 falls outside; nothing wrapped round to the far edge.
        expect(at(0, 0)).toEqual([0, 0, 0, 0]);
        expect(at(0, 3)).toEqual([0, 0, 0, 0]);
    });

    it("produces an empty canvas for a layer with no pixels", async () => {
        const layer = { name: "Empty", left: 0, top: 0 } as unknown as Layer;
        const decoded = decodePngToRgba(await bakeLayer(layer, { width: 2, height: 2 }, deflate), inflate);
        expect([...decoded.rgba]).toEqual(new Array(16).fill(0));
    });
});

describe("bakeLayers with a merge", () => {
    /** A red base with a half-strength white multiply layer over it, both 2×2 at the origin. */
    function psdWithBlend(mode: string): Psd {
        const solid = (r: number, g: number, b: number, a: number) => ({
            width: 2, height: 2,
            data: new Uint8Array([r, g, b, a, r, g, b, a, r, g, b, a, r, g, b, a]),
        });
        return {
            width: 2, height: 2,
            children: [
                { name: "Body", left: 0, top: 0, opacity: 1, blendMode: "normal", imageData: solid(200, 200, 200, 255) },
                { name: "Shade", left: 0, top: 0, opacity: 1, blendMode: mode, imageData: solid(128, 128, 128, 255) },
            ],
        } as unknown as Psd;
    }

    it("flattens the merged layer using its own blend mode, not as a plain stack", async () => {
        const written = new Map<string, Uint8Array>();
        const write = async (name: string, png: Uint8Array) => { written.set(name, png); return name; };
        const merged = await bakeLayers(
            psdWithBlend("multiply"),
            [{ path: ["Body"], mergeFrom: [["Shade"]] }],
            deflate,
            write,
        );
        expect(merged).toHaveLength(1);
        const decoded = decodePngToRgba(written.get(merged[0].filePath)!, inflate);
        // multiply: 200/255 * 128/255 ≈ 0.394 → ~100. A plain stack would have left 128.
        expect(decoded.rgba[0]).toBeGreaterThan(95);
        expect(decoded.rgba[0]).toBeLessThan(105);
        expect(decoded.rgba[3]).toBe(255);
    });

    it("leaves the base alone when nothing is merged onto it", async () => {
        const written = new Map<string, Uint8Array>();
        const write = async (name: string, png: Uint8Array) => { written.set(name, png); return name; };
        const plain = await bakeLayers(psdWithBlend("multiply"), [{ path: ["Body"] }], deflate, write);
        expect(decodePngToRgba(written.get(plain[0].filePath)!, inflate).rgba[0]).toBe(200);
    });
});
