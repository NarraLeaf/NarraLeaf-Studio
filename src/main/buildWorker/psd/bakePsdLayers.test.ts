import zlib from "zlib";
import { describe, expect, it } from "vitest";
import { readPsd, writePsdBuffer, type Layer, type Psd } from "ag-psd";
import { decodePngToRgba } from "@shared/utils/pngOpaque";
import { flattenLeaves, planImport, psdLayerKey, toBakeTargets, unsupportedBlends } from "@shared/utils/psdLayerPlan";
import { bakeLayer, bakeLayers, describePsd, indexLayers } from "./bakePsdLayers";
import { initializePsdImageData } from "./initializePsdImageData";

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

    it("keeps layers in a hidden group out of the import plan", () => {
        const psd = {
            width: 1, height: 1,
            children: [
                { name: "Body" },
                { name: "Hidden group", hidden: true, children: [
                    { name: "Nested", children: [{ name: "Shade", blendMode: "multiply" }] },
                ] },
            ],
        } as unknown as Psd;
        const leaves = flattenLeaves(describePsd(psd, "sheet.psd").layers);
        const plan = planImport(leaves, {});

        expect(plan.baking.map(layer => layer.name)).toEqual(["Body"]);
        expect(plan.dropped).toEqual([{ leaf: expect.objectContaining({ name: "Shade" }), reason: "hidden" }]);
        expect(unsupportedBlends(leaves)).toEqual([]);
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

describe("layers with the same name", () => {
    const pixel = (red: number, blue: number) => ({ width: 1, height: 1, data: new Uint8Array([red, 0, blue, 255]) });

    it("plans and bakes each sibling's own pixels", async () => {
        const psd = {
            width: 1, height: 1,
            children: [
                { id: 11, name: "Body", imageData: pixel(255, 0) },
                { id: 22, name: "Body", imageData: pixel(0, 255) },
            ],
        } as unknown as Psd;
        const leaves = flattenLeaves(describePsd(psd, "sheet.psd").layers);
        const targets = toBakeTargets(planImport(leaves, {}));
        const written = new Map<string, Uint8Array>();
        const baked = await bakeLayers(psd, targets, deflate, async (name, png) => { written.set(name, png); return name; });

        expect(targets.map(target => [target.path, target.occurrence, target.sourceId])).toEqual([
            [["Body"], 0, 11], [["Body"], 1, 22],
        ]);
        expect(new Set(baked.map(psdLayerKey)).size).toBe(2);
        expect(baked.map(layer => [...decodePngToRgba(written.get(layer.filePath)!, inflate).rgba])).toEqual([
            [255, 0, 0, 255], [0, 0, 255, 255],
        ]);
    });

    it("preserves same-named layers from a real PSD byte stream", async () => {
        initializePsdImageData();
        const data = (red: number, blue: number) => ({
            width: 1, height: 1, data: new Uint8ClampedArray([red, 0, blue, 255]),
        });
        const bytes = writePsdBuffer({
            width: 1, height: 1,
            imageData: data(0, 0),
            children: [
                { id: 11, name: "Body", imageData: data(255, 0) },
                { id: 22, name: "Body", imageData: data(0, 255) },
            ],
        });
        const psd = readPsd(bytes, { skipCompositeImageData: true, skipThumbnail: true, useImageData: true });
        const targets = toBakeTargets(planImport(flattenLeaves(describePsd(psd, "sheet.psd").layers), {}));
        const written = new Map<string, Uint8Array>();
        const baked = await bakeLayers(psd, targets, deflate, async (name, png) => { written.set(name, png); return name; });
        expect(baked.map(layer => [layer.sourceId, [...decodePngToRgba(written.get(layer.filePath)!, inflate).rgba]])).toEqual([
            [11, [255, 0, 0, 255]], [22, [0, 0, 255, 255]],
        ]);
    });

    it("bakes repeated PSD layer ids by occurrence", async () => {
        initializePsdImageData();
        const data = (red: number, blue: number) => ({
            width: 1, height: 1, data: new Uint8ClampedArray([red, 0, blue, 255]),
        });
        const bytes = writePsdBuffer({
            width: 1, height: 1, imageData: data(0, 0),
            children: [
                { id: 11, name: "Body", imageData: data(255, 0) },
                { id: 22, name: "Body", imageData: data(0, 255) },
            ],
        });
        const marker = Buffer.from("8BIMlyid");
        const offsets: number[] = [];
        for (let offset = bytes.indexOf(marker); offset !== -1; offset = bytes.indexOf(marker, offset + marker.length)) {
            offsets.push(offset);
        }
        expect(offsets).toHaveLength(2);
        bytes.writeUInt32BE(11, offsets[0] + 12);
        bytes.writeUInt32BE(11, offsets[1] + 12);
        const psd = readPsd(bytes, { skipCompositeImageData: true, skipThumbnail: true, useImageData: true });
        expect(psd.children?.map(layer => layer.id)).toEqual([11, 11]);
        const leaves = flattenLeaves(describePsd(psd, "sheet.psd").layers);
        expect(leaves.map(leaf => [leaf.occurrence, leaf.sourceId])).toEqual([[0, undefined], [1, undefined]]);

        const written = new Map<string, Uint8Array>();
        const baked = await bakeLayers(psd, toBakeTargets(planImport(leaves, {})), deflate, async (name, png) => {
            written.set(name, png);
            return name;
        });
        expect(baked.map(layer => [...decodePngToRgba(written.get(layer.filePath)!, inflate).rgba])).toEqual([
            [255, 0, 0, 255], [0, 0, 255, 255],
        ]);
    });

    it("keeps literal slashes in names distinct from group separators", async () => {
        const psd = {
            width: 1, height: 1,
            children: [
                { name: "Mood/Happy", imageData: pixel(255, 0) },
                { name: "Mood", children: [{ name: "Happy", imageData: pixel(0, 255) }] },
            ],
        } as unknown as Psd;
        const targets = toBakeTargets(planImport(flattenLeaves(describePsd(psd, "sheet.psd").layers), {}));
        const written = new Map<string, Uint8Array>();
        const baked = await bakeLayers(psd, targets, deflate, async (name, png) => { written.set(name, png); return name; });
        expect(baked.map(layer => [...decodePngToRgba(written.get(layer.filePath)!, inflate).rgba])).toEqual([
            [255, 0, 0, 255], [0, 0, 255, 255],
        ]);
    });

    it("refuses to bake the wrong duplicate if the PSD changed after it was read", async () => {
        const first = { id: 11, name: "Body", imageData: pixel(255, 0) };
        const second = { id: 22, name: "Body", imageData: pixel(0, 255) };
        const psd = { width: 1, height: 1, children: [first, second] } as unknown as Psd;
        const targets = toBakeTargets(planImport(flattenLeaves(describePsd(psd, "sheet.psd").layers), {}));
        psd.children = [second, first] as unknown as Layer[];
        await expect(bakeLayers(psd, targets, deflate, async name => name)).rejects.toThrow(/changed before it was baked/);
    });

    it("reports a requested layer that disappeared before the bake", async () => {
        const first = { id: 11, name: "Body", imageData: pixel(255, 0) };
        const second = { id: 22, name: "Body", imageData: pixel(0, 255) };
        const psd = { width: 1, height: 1, children: [first, second] } as unknown as Psd;
        const targets = toBakeTargets(planImport(flattenLeaves(describePsd(psd, "sheet.psd").layers), {}));
        psd.children = [second] as unknown as Layer[];
        await expect(bakeLayers(psd, targets, deflate, async name => name)).rejects.toThrow(/Body.*no longer.*PSD/);
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
            [{ path: ["Body"], mergeFrom: [{ path: ["Shade"] }] }],
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

    it("names each file as its layer, so the asset it becomes is called that", async () => {
        // The library names an asset after its file; a position prefix made every PSD layer
        // `000-…`, `001-…`. Two layers of one name still land in two files.
        const written = new Map<string, Uint8Array>();
        const write = async (name: string, png: Uint8Array) => { written.set(name, png); return name; };
        const baked = await bakeLayers(
            psdWithBlend("multiply"),
            [{ path: ["Body"], name: "Mio_Body" }, { path: ["Shade"], name: "Mio_Body" }],
            deflate,
            write,
        );
        const basenames = baked.map(layer => layer.filePath.split("/").pop());
        expect(basenames).toEqual(["Mio_Body.png", "Mio_Body.png"]);
        expect(new Set(baked.map(layer => layer.filePath)).size).toBe(2);
    });

    it("leaves the base alone when nothing is merged onto it", async () => {
        const written = new Map<string, Uint8Array>();
        const write = async (name: string, png: Uint8Array) => { written.set(name, png); return name; };
        const plain = await bakeLayers(psdWithBlend("multiply"), [{ path: ["Body"] }], deflate, write);
        expect(decodePngToRgba(written.get(plain[0].filePath)!, inflate).rgba[0]).toBe(200);
    });
});

describe("layer masks", () => {
    /** ag-psd hands a mask back with its value copied into every colour channel. */
    function maskData(width: number, height: number, values: number[]) {
        const data = new Uint8Array(width * height * 4);
        values.forEach((value, index) => {
            data[index * 4] = value;
            data[index * 4 + 1] = value;
            data[index * 4 + 2] = value;
            data[index * 4 + 3] = 255;
        });
        return { width, height, data };
    }

    const opaque2x2 = {
        width: 2, height: 2,
        data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
    };

    it("multiplies the mask into alpha", async () => {
        const layer = {
            name: "Face", left: 0, top: 0, opacity: 1, imageData: opaque2x2,
            mask: { left: 0, top: 0, right: 2, bottom: 2, imageData: maskData(2, 2, [0, 255, 128, 255]) },
        } as unknown as Layer;
        const decoded = decodePngToRgba(await bakeLayer(layer, { width: 2, height: 2 }, deflate), inflate);
        expect([decoded.rgba[3], decoded.rgba[7], decoded.rgba[11], decoded.rgba[15]]).toEqual([0, 255, 128, 255]);
        // Colour is untouched where the mask lets the pixel through.
        expect([...decoded.rgba.slice(4, 7)]).toEqual([255, 0, 0]);
    });

    it("ignores a mask the author switched off", async () => {
        const layer = {
            name: "Face", left: 0, top: 0, opacity: 1, imageData: opaque2x2,
            mask: { left: 0, top: 0, right: 2, bottom: 2, disabled: true, imageData: maskData(2, 2, [0, 0, 0, 0]) },
        } as unknown as Layer;
        const decoded = decodePngToRgba(await bakeLayer(layer, { width: 2, height: 2 }, deflate), inflate);
        expect(decoded.rgba[3]).toBe(255);
    });

    it("fills outside the mask's rectangle with its default colour, not with nothing", async () => {
        // The rectangle is only the bounding box of the painted part; treating everything beyond it
        // as hidden would blank most of a mask that was painted in one corner.
        const layer = {
            name: "Face", left: 0, top: 0, opacity: 1, imageData: opaque2x2,
            mask: { left: 0, top: 0, right: 1, bottom: 1, defaultColor: 255, imageData: maskData(1, 1, [0]) },
        } as unknown as Layer;
        const decoded = decodePngToRgba(await bakeLayer(layer, { width: 2, height: 2 }, deflate), inflate);
        expect([decoded.rgba[3], decoded.rgba[7], decoded.rgba[11], decoded.rgba[15]]).toEqual([0, 255, 255, 255]);
    });
});

describe("clipping masks", () => {
    /** A base covering only the left column, with a full-canvas blush clipped to it. */
    function psdWithClip(): Psd {
        const column = {
            width: 2, height: 2,
            data: new Uint8Array([200, 200, 200, 255, 0, 0, 0, 0, 200, 200, 200, 255, 0, 0, 0, 0]),
        };
        const fill = {
            width: 2, height: 2,
            data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
        };
        return {
            width: 2, height: 2,
            children: [
                { name: "Body", left: 0, top: 0, opacity: 1, blendMode: "normal", imageData: column },
                { name: "Blush", left: 0, top: 0, opacity: 1, blendMode: "normal", clipping: true, imageData: fill },
            ],
        } as unknown as Psd;
    }

    it("cuts a clipped layer to the base's alpha instead of letting it cover the canvas", async () => {
        const written = new Map<string, Uint8Array>();
        const write = async (name: string, png: Uint8Array) => { written.set(name, png); return name; };
        const baked = await bakeLayers(
            psdWithClip(),
            [{ path: ["Body"], mergeFrom: [{ path: ["Blush"], clip: true }] }],
            deflate,
            write,
        );
        const decoded = decodePngToRgba(written.get(baked[0].filePath)!, inflate);
        // Where the base is, the blush shows...
        expect([...decoded.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
        // ...and where it is not, nothing does. Without the clip this pixel would be opaque red.
        expect([...decoded.rgba.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    });

    it("clips to the base's own alpha, not to what an earlier merge widened it to", async () => {
        const psd = psdWithClip();
        // A full-canvas layer merged in first would make the whole canvas opaque; the clip that
        // follows still has to answer to the base alone.
        (psd.children as Layer[]).push({
            name: "Glow", left: 0, top: 0, opacity: 1, blendMode: "normal",
            imageData: { width: 2, height: 2, data: new Uint8Array(16).fill(255) },
        } as unknown as Layer);
        const written = new Map<string, Uint8Array>();
        const write = async (name: string, png: Uint8Array) => { written.set(name, png); return name; };
        const baked = await bakeLayers(
            psd,
            [{ path: ["Body"], mergeFrom: [{ path: ["Glow"] }, { path: ["Blush"], clip: true }] }],
            deflate,
            write,
        );
        const decoded = decodePngToRgba(written.get(baked[0].filePath)!, inflate);
        // Glow made this pixel opaque white; the blush must not have reached it.
        expect([...decoded.rgba.slice(4, 8)]).toEqual([255, 255, 255, 255]);
    });
});
