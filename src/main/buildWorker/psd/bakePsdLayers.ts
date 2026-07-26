import type { Layer, Psd } from "ag-psd";
import type { PsdBakeTarget, PsdBakedLayer, PsdDocument, PsdLayerNode } from "@shared/types/psdImport";
import { encodeRgbaPng } from "@shared/utils/pngOpaque";
import { joinPath } from "@shared/utils/psdLayerPlan";
import { blendOver } from "./blendModes";

type Deflate = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** The tree, geometry only. Pixels stay in the worker until a bake asks for them. */
export function describePsd(psd: Psd, fileName: string): PsdDocument {
    const walk = (layers: Layer[], prefix: string[]): PsdLayerNode[] => layers.map(layer => {
        const name = layer.name ?? "";
        const path = [...prefix, name];
        const node: PsdLayerNode = {
            path,
            name,
            blendMode: layer.blendMode ?? "normal",
            opacity: layer.opacity ?? 1,
            hidden: layer.hidden === true,
            clipping: layer.clipping === true,
        };
        if (layer.children) {
            node.children = walk(layer.children, path);
        } else {
            node.bounds = {
                left: layer.left ?? 0,
                top: layer.top ?? 0,
                right: layer.right ?? 0,
                bottom: layer.bottom ?? 0,
            };
        }
        return node;
    });
    return { width: psd.width, height: psd.height, fileName, layers: walk(psd.children ?? [], []) };
}

/** Index every drawable layer by its joined path, so a bake request can address them by name. */
export function indexLayers(psd: Psd): Map<string, Layer> {
    const index = new Map<string, Layer>();
    const walk = (layers: Layer[], prefix: string[]): void => {
        for (const layer of layers) {
            const path = [...prefix, layer.name ?? ""];
            if (layer.children) {
                walk(layer.children, path);
            } else {
                index.set(joinPath(path), layer);
            }
        }
    };
    walk(psd.children ?? [], []);
    return index;
}

/**
 * Draw one PSD layer onto a transparent document-sized canvas and encode it.
 *
 * Full canvas size is the whole point: the engine scales each layer independently under `autoFit`,
 * so a cropped layer would be blown up to the stage on its own rather than sitting where the artist
 * put it. Photoshop stores a layer trimmed to its own bounds, and this is where that is undone.
 *
 * Layer opacity is multiplied into alpha here rather than carried as metadata — the engine has no
 * per-layer opacity, so the only place it can survive is in the pixels.
 */
export function rasterizeLayer(
    layer: Layer,
    document: { width: number; height: number },
): Uint8Array {
    const canvas = new Uint8Array(document.width * document.height * 4);
    const source = layer.imageData;
    if (!source) {
        return canvas;
    }
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const opacity = layer.opacity ?? 1;
    for (let y = 0; y < source.height; y++) {
        const targetY = top + y;
        if (targetY < 0 || targetY >= document.height) continue;
        for (let x = 0; x < source.width; x++) {
            const targetX = left + x;
            if (targetX < 0 || targetX >= document.width) continue;
            const from = (y * source.width + x) * 4;
            const to = (targetY * document.width + targetX) * 4;
            canvas[to] = source.data[from];
            canvas[to + 1] = source.data[from + 1];
            canvas[to + 2] = source.data[from + 2];
            canvas[to + 3] = Math.round(source.data[from + 3] * opacity);
        }
    }
    return canvas;
}

export async function bakeLayer(
    layer: Layer,
    document: { width: number; height: number },
    deflate: Deflate,
): Promise<Uint8Array> {
    return encodeRgbaPng(rasterizeLayer(layer, document), document.width, document.height, deflate);
}

/**
 * Bake each requested target, flattening any layers the author chose to merge onto it.
 *
 * A merged layer is composited with *its own* blend mode, which is the whole point: the engine only
 * stacks, so a `multiply` shadow either becomes part of the pixels here or it does not survive.
 */
export async function bakeLayers(
    psd: Psd,
    targets: PsdBakeTarget[],
    deflate: Deflate,
    write: (name: string, png: Uint8Array) => Promise<string>,
): Promise<PsdBakedLayer[]> {
    const index = indexLayers(psd);
    const baked: PsdBakedLayer[] = [];
    for (const [position, target] of targets.entries()) {
        const layer = index.get(joinPath(target.path));
        if (!layer) continue;
        const canvas = rasterizeLayer(layer, psd);
        for (const mergePath of target.mergeFrom ?? []) {
            const above = index.get(joinPath(mergePath));
            if (!above) continue;
            blendOver(canvas, rasterizeLayer(above, psd), above.blendMode ?? "normal");
        }
        const name = layer.name ?? target.path[target.path.length - 1] ?? "";
        const png = await encodeRgbaPng(canvas, psd.width, psd.height, deflate);
        baked.push({
            path: target.path,
            name,
            // Prefixed with the position so two layers of the same name in different groups do not
            // collide on disk, and so the import order is readable in the temp directory.
            filePath: await write(`${String(position).padStart(3, "0")}-${sanitize(name)}.png`, png),
        });
    }
    return baked;
}

/** Reduce a Photoshop layer name to something safe to put in a filename. */
function sanitize(name: string): string {
    const cleaned = name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+/, "").slice(0, 60);
    return cleaned || "layer";
}
