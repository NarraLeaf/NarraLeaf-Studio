import type { Layer, Psd } from "ag-psd";
import type {
  PsdBakeTarget,
  PsdBakedLayer,
  PsdDocument,
  PsdLayerNode
} from "@shared/types/psdImport";
import { encodeRgbaPng } from "@shared/utils/pngOpaque";
import { joinPath } from "@shared/utils/psdLayerPlan";
import { blendOver } from "./blendModes";

type Deflate = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** The tree, geometry only. Pixels stay in the worker until a bake asks for them. */
export function describePsd(psd: Psd, fileName: string): PsdDocument {
  const walk = (layers: Layer[], prefix: string[]): PsdLayerNode[] =>
    layers.map((layer) => {
      const name = layer.name ?? "";
      const path = [...prefix, name];
      const node: PsdLayerNode = {
        path,
        name,
        blendMode: layer.blendMode ?? "normal",
        opacity: layer.opacity ?? 1,
        hidden: layer.hidden === true,
        clipping: layer.clipping === true
      };
      if (layer.children) {
        node.children = walk(layer.children, path);
      } else {
        node.bounds = {
          left: layer.left ?? 0,
          top: layer.top ?? 0,
          right: layer.right ?? 0,
          bottom: layer.bottom ?? 0
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
 * How much of a layer its own mask lets through at one document pixel, 0–255.
 *
 * ag-psd hands the mask back as RGBA with the mask value copied into every colour channel and alpha
 * forced opaque, so the red channel is the mask. Outside the mask's own rectangle Photoshop fills
 * with `defaultColor` — that rectangle is only the bounding box of the painted part, not the extent
 * of the mask's effect, which is why sampling outside it has to fall back rather than return 0.
 */
function maskValueAt(mask: NonNullable<Layer["mask"]>, docX: number, docY: number): number {
  const data = mask.imageData;
  const left = mask.left ?? 0;
  const top = mask.top ?? 0;
  // A mask block always carries a default colour; treating an absent one as "shows" fails towards
  // keeping art rather than silently blanking a layer.
  const fallback = mask.defaultColor ?? 255;
  if (!data) {
    return fallback;
  }
  const x = docX - left;
  const y = docY - top;
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) {
    return fallback;
  }
  return data.data[(y * data.width + x) * 4];
}

/**
 * Draw one PSD layer onto a transparent document-sized canvas and encode it.
 *
 * Full canvas size is the whole point: the engine scales each layer independently under `autoFit`,
 * so a cropped layer would be blown up to the stage on its own rather than sitting where the artist
 * put it. Photoshop stores a layer trimmed to its own bounds, and this is where that is undone.
 *
 * Layer opacity and the layer mask are both multiplied into alpha here rather than carried as
 * metadata — the engine has neither, so the pixels are the only place they can survive.
 */
export function rasterizeLayer(
  layer: Layer,
  document: { width: number; height: number }
): Uint8Array {
  const canvas = new Uint8Array(document.width * document.height * 4);
  const source = layer.imageData;
  if (!source) {
    return canvas;
  }
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const opacity = layer.opacity ?? 1;
  // A disabled mask is one the author switched off in Photoshop; it is stored but not shown.
  const mask = layer.mask && !layer.mask.disabled ? layer.mask : null;
  // `positionRelativeToLayer` means the mask rectangle is stored in the layer's frame rather than
  // the document's, so it has to be lifted into document coordinates before it can be sampled.
  const maskOffsetX = mask?.positionRelativeToLayer ? left : 0;
  const maskOffsetY = mask?.positionRelativeToLayer ? top : 0;
  for (let y = 0; y < source.height; y++) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= document.height) continue;
    for (let x = 0; x < source.width; x++) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= document.width) continue;
      const from = (y * source.width + x) * 4;
      const to = (targetY * document.width + targetX) * 4;
      const masked = mask
        ? maskValueAt(mask, targetX - maskOffsetX, targetY - maskOffsetY) / 255
        : 1;
      canvas[to] = source.data[from];
      canvas[to + 1] = source.data[from + 1];
      canvas[to + 2] = source.data[from + 2];
      canvas[to + 3] = Math.round(source.data[from + 3] * opacity * masked);
    }
  }
  return canvas;
}

/**
 * Restrict `pixels` to where `alpha` is opaque — Photoshop's clipping mask.
 *
 * The alpha handed in is the base layer's *own*, sampled before anything was merged onto it: a clip
 * is defined against the layer it is clipped to, not against whatever has since been flattened into
 * the same canvas.
 */
export function clipToAlpha(pixels: Uint8Array, alpha: Uint8Array): void {
  for (let i = 0, a = 0; i < pixels.length; i += 4, a++) {
    pixels[i + 3] = Math.round(pixels[i + 3] * (alpha[a] / 255));
  }
}

function alphaChannel(pixels: Uint8Array): Uint8Array {
  const alpha = new Uint8Array(pixels.length / 4);
  for (let i = 0, a = 0; i < pixels.length; i += 4, a++) {
    alpha[a] = pixels[i + 3];
  }
  return alpha;
}

export async function bakeLayer(
  layer: Layer,
  document: { width: number; height: number },
  deflate: Deflate
): Promise<Uint8Array> {
  return encodeRgbaPng(rasterizeLayer(layer, document), document.width, document.height, deflate);
}

/**
 * Bake each requested target, flattening onto it whatever the plan attached.
 *
 * A flattened layer is composited with *its own* blend mode, which is the whole point: the engine
 * only stacks, so a `multiply` shadow either becomes part of the pixels here or it does not survive.
 * A clipped one is cut to the target's own alpha first, which is the other half of the same idea —
 * the engine has no clipping masks either.
 */
export async function bakeLayers(
  psd: Psd,
  targets: PsdBakeTarget[],
  deflate: Deflate,
  write: (name: string, png: Uint8Array) => Promise<string>
): Promise<PsdBakedLayer[]> {
  const index = indexLayers(psd);
  const baked: PsdBakedLayer[] = [];
  for (const [position, target] of targets.entries()) {
    const layer = index.get(joinPath(target.path));
    if (!layer) continue;
    const canvas = rasterizeLayer(layer, psd);
    // Taken before the first merge: a clip is defined against the base layer, and merging into
    // the canvas first would let one flattened layer widen the mask for the next.
    const baseAlpha = target.mergeFrom?.some((source) => source.clip) ? alphaChannel(canvas) : null;
    for (const source of target.mergeFrom ?? []) {
      const above = index.get(joinPath(source.path));
      if (!above) continue;
      const pixels = rasterizeLayer(above, psd);
      if (source.clip && baseAlpha) {
        clipToAlpha(pixels, baseAlpha);
      }
      blendOver(canvas, pixels, above.blendMode ?? "normal");
    }
    const name = layer.name ?? target.path[target.path.length - 1] ?? "";
    const png = await encodeRgbaPng(canvas, psd.width, psd.height, deflate);
    baked.push({
      path: target.path,
      name,
      // Prefixed with the position so two layers of the same name in different groups do not
      // collide on disk, and so the import order is readable in the temp directory.
      filePath: await write(
        `${String(position).padStart(3, "0")}-${sanitize(target.name ?? name)}.png`,
        png
      )
    });
  }
  return baked;
}

/** Reduce a Photoshop layer name to something safe to put in a filename. */
function sanitize(name: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 60);
  return cleaned || "layer";
}
