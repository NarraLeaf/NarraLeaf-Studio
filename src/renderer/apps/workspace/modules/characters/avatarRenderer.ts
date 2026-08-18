import { findHeadCrop, type NormalizedCrop } from "@/lib/utils/headCrop";
import type { AvatarRenderer } from "./avatarBake";

/**
 * The canvas half of the avatar bake: composite the stack, frame it on the head, encode a PNG.
 *
 * Kept apart from `avatarBake` so the orchestration there (fingerprint gating, table bookkeeping,
 * stale-file cleanup) can be unit-tested without a DOM, which is the same split `iconBake` uses
 * between its recipe and its rendering.
 */

/** Decode one asset to a drawable bitmap, or null when it cannot be read. */
export type AvatarAssetDecoder = (assetId: string) => Promise<ImageBitmap | null>;

/**
 * Draw every layer at its own size, centred — the rule the engine renders a stack by, and the same
 * one `drawStack` uses for the editor's composites. A layer of a different size is stretched to the
 * stage on its own rather than being nudged, so centring is what matches the runtime.
 */
function compositeStack(bitmaps: readonly ImageBitmap[]): OffscreenCanvas | null {
  if (bitmaps.length === 0) {
    return null;
  }
  const width = Math.max(...bitmaps.map((bitmap) => bitmap.width));
  const height = Math.max(...bitmaps.map((bitmap) => bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingQuality = "high";
  for (const bitmap of bitmaps) {
    ctx.drawImage(bitmap, (width - bitmap.width) / 2, (height - bitmap.height) / 2);
  }
  return canvas;
}

/**
 * Where to frame the avatar. The author's rect wins verbatim; otherwise the head is located from
 * the composited silhouette — which is why this runs on the composite rather than on any one layer:
 * a character's head may well be drawn by a layer that is not the biggest one.
 *
 * A silhouette that yields nothing (a fully transparent or fully opaque composite) falls back to
 * the whole image rather than to a guess.
 *
 * `findHeadCrop` is called on the composite's *own* pixels, not on a downscaled analysis bitmap.
 * `headCrop`'s `ANALYSIS_MAX` only applies to its URL-driven path (`detectHeadCrop`, which the
 * story-editor badges use), and it would be harmless either way: the answer is normalized 0–1, so
 * whichever bitmap measured it, {@link planAvatarEncode} multiplies it back out against the
 * full-resolution source. Nothing here is ever read off a 220px bitmap.
 */
function resolveFrame(
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D,
  crop: NormalizedCrop | undefined
): NormalizedCrop {
  if (crop) {
    return crop;
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return findHeadCrop(pixels.data, pixels.width, pixels.height) ?? { x: 0, y: 0, w: 1, h: 1 };
}

/** Where the crop is read from the source, and how big the PNG it lands in is. */
export type AvatarEncodePlan = {
  /** Source rectangle, in the composite's own pixels, clamped inside it. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Edge of the square PNG. */
  size: number;
  /** Destination size of the crop inside that square. Equals `sw`/`sh` whenever nothing is scaled. */
  dw: number;
  dh: number;
};

/**
 * Decide the output geometry. Exported and pure because it is the whole resolution promise: an
 * avatar that silently goes soft again is this function returning a `dw` smaller than its `sw`.
 *
 * **Source resolution, never upsampled.** The crop is copied at 1:1 and only ever scaled *down*,
 * and only to respect `maxSize`. The previous rule scaled in both directions to reach a fixed 256,
 * which downsampled every realistic sprite (a 1088×1984 sprite crops to about 478px of head) and
 * upsampled small ones into blur they never had. A dialog box asks for several hundred device
 * pixels once the design-space scale and the device pixel ratio have both been applied, so 256 was
 * never enough and interpolating up to it would not have helped.
 *
 * **Square, letterboxed.** The crop is already square in image pixels — both producers make it so
 * (`findHeadCrop` fits a square box, and the author's drag keeps one) — so in practice this pads
 * nothing and the square costs no bytes. It is kept for the case where a crop is not square,
 * because the thing that displays a baked avatar is an `nl.image` widget laid out in a square box
 * with `imageFill.mode: "cover"` (the default dialog template): a non-square PNG there is
 * centre-cropped by the widget, which would quietly cut away part of the framing the author chose.
 * Letterboxing keeps that decision here, where the author can see it.
 */
export function planAvatarEncode(
  source: { width: number; height: number },
  frame: NormalizedCrop,
  maxSize: number
): AvatarEncodePlan {
  const sx = clamp(Math.round(frame.x * source.width), 0, Math.max(0, source.width - 1));
  const sy = clamp(Math.round(frame.y * source.height), 0, Math.max(0, source.height - 1));
  const sw = clamp(Math.round(frame.w * source.width), 1, source.width - sx);
  const sh = clamp(Math.round(frame.h * source.height), 1, source.height - sy);

  const long = Math.max(sw, sh);
  // `min(1, …)` is the whole of "never upsample": a crop smaller than the ceiling is copied 1:1.
  const scale = Math.min(1, maxSize / long);
  return {
    sx,
    sy,
    sw,
    sh,
    size: Math.max(1, Math.round(long * scale)),
    dw: Math.max(1, Math.round(sw * scale)),
    dh: Math.max(1, Math.round(sh * scale))
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Draw the framed region into its square and encode it. See {@link planAvatarEncode}. */
async function encodeSquare(
  source: OffscreenCanvas,
  frame: NormalizedCrop,
  maxSize: number
): Promise<Uint8Array | null> {
  const plan = planAvatarEncode(source, frame, maxSize);

  const out = new OffscreenCanvas(plan.size, plan.size);
  const ctx = out.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    plan.sx,
    plan.sy,
    plan.sw,
    plan.sh,
    (plan.size - plan.dw) / 2,
    (plan.size - plan.dh) / 2,
    plan.dw,
    plan.dh
  );

  const blob = await out.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Build the renderer `bakeCharacterAvatars` takes, over a decoder for the project's assets. */
export function createAvatarRenderer(decode: AvatarAssetDecoder): AvatarRenderer {
  return async ({ layers, crop, maxSize }) => {
    const ids = layers.filter((assetId): assetId is string => Boolean(assetId));
    const bitmaps = (await Promise.all(ids.map((id) => decode(id)))).filter(
      (bitmap): bitmap is ImageBitmap => Boolean(bitmap)
    );
    try {
      const composite = compositeStack(bitmaps);
      const ctx = composite?.getContext("2d");
      if (!composite || !ctx) {
        return null;
      }
      return await encodeSquare(composite, resolveFrame(composite, ctx, crop), maxSize);
    } finally {
      // Bitmaps hold decoded pixels off-heap; a bake of sixty differentials would otherwise
      // keep every layer of every one of them alive until GC got around to it.
      for (const bitmap of bitmaps) {
        bitmap.close();
      }
    }
  };
}
