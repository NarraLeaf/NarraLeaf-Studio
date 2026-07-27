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
    const width = Math.max(...bitmaps.map(bitmap => bitmap.width));
    const height = Math.max(...bitmaps.map(bitmap => bitmap.height));
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
 */
function resolveFrame(
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
    crop: NormalizedCrop | undefined,
): NormalizedCrop {
    if (crop) {
        return crop;
    }
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return findHeadCrop(pixels.data, pixels.width, pixels.height) ?? { x: 0, y: 0, w: 1, h: 1 };
}

/**
 * Render the framed region into a square of `size`, letterboxing rather than stretching: a crop is
 * not necessarily square, and squashing a face to fit is worse than transparent margins.
 */
async function encodeSquare(
    source: OffscreenCanvas,
    frame: NormalizedCrop,
    size: number,
): Promise<Uint8Array | null> {
    const sx = Math.max(0, Math.round(frame.x * source.width));
    const sy = Math.max(0, Math.round(frame.y * source.height));
    const sw = Math.max(1, Math.round(frame.w * source.width));
    const sh = Math.max(1, Math.round(frame.h * source.height));

    const scale = Math.min(size / sw, size / sh);
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const out = new OffscreenCanvas(size, size);
    const ctx = out.getContext("2d");
    if (!ctx) {
        return null;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, sx, sy, sw, sh, (size - dw) / 2, (size - dh) / 2, dw, dh);

    const blob = await out.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
}

/** Build the renderer `bakeCharacterAvatars` takes, over a decoder for the project's assets. */
export function createAvatarRenderer(decode: AvatarAssetDecoder): AvatarRenderer {
    return async ({ layers, crop, size }) => {
        const ids = layers.filter((assetId): assetId is string => Boolean(assetId));
        const bitmaps = (await Promise.all(ids.map(id => decode(id))))
            .filter((bitmap): bitmap is ImageBitmap => Boolean(bitmap));
        try {
            const composite = compositeStack(bitmaps);
            const ctx = composite?.getContext("2d");
            if (!composite || !ctx) {
                return null;
            }
            return await encodeSquare(composite, resolveFrame(composite, ctx, crop), size);
        } finally {
            // Bitmaps hold decoded pixels off-heap; a bake of sixty differentials would otherwise
            // keep every layer of every one of them alive until GC got around to it.
            for (const bitmap of bitmaps) {
                bitmap.close();
            }
        }
    };
}
