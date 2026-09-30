import { nativeImage } from "electron";

/**
 * Fitting an author's app icon into a box of a given size.
 *
 * Shared by the two things that need it - the mobile shells' icon slots and the
 * desktop `.ico`/`.icns` containers - because they need exactly the same
 * behaviour and had no business each having their own idea of what "resize"
 * means.
 *
 * `nativeImage` is a main-process API, which is why this lives here rather than
 * in a worker: the packaging worker only ever sees the paths of finished files.
 */

/**
 * `source` scaled to fit inside `width` x `height`, centred, with the remaining
 * space left transparent.
 *
 * The aspect ratio is preserved. Passing `nativeImage.resize` both a width and a
 * height makes it resize to exactly those, so a 1000x500 logo arrived on the
 * launcher squashed into a square with no warning anywhere; letterboxing is the
 * honest answer for a source that is not square.
 *
 * Note what this does *not* do: it never composites onto a background.
 * Flattening (which iOS requires, since the App Store rejects an icon with an
 * alpha channel) happens in the authoring bake, where a canvas does the blending
 * with known semantics; nativeImage's raw bitmaps are premultiplied on some
 * platforms and not others, and getting that wrong shows up as a halo nobody
 * would trace back to here.
 */
export function scaleIconTo(
    source: Electron.NativeImage,
    width: number,
    height: number,
): Electron.NativeImage {
    const sourceSize = source.getSize();
    const scale = Math.min(width / sourceSize.width, height / sourceSize.height);
    const drawWidth = Math.max(1, Math.round(sourceSize.width * scale));
    const drawHeight = Math.max(1, Math.round(sourceSize.height * scale));
    // "good" is nativeImage's highest-quality resampling - icons are downscaled
    // a long way (1024 to 48 at mdpi) and this is a one-off cost.
    const resized = source.resize({ width: drawWidth, height: drawHeight, quality: "good" });
    return drawWidth === width && drawHeight === height
        ? resized
        : centerOnTransparentCanvas(resized, width, height);
}

/**
 * Place an image in the middle of a larger transparent rectangle. A straight
 * copy of the pixel rows - no blending - so it is indifferent to whether the
 * platform's bitmaps carry premultiplied alpha.
 */
function centerOnTransparentCanvas(
    image: Electron.NativeImage,
    width: number,
    height: number,
): Electron.NativeImage {
    const source = image.getSize();
    // nativeImage bitmaps are 4 bytes per pixel; the channel order does not
    // matter here because whole pixels are copied verbatim.
    const bytesPerPixel = 4;
    const sourceBitmap = image.toBitmap();
    const canvas = Buffer.alloc(width * height * bytesPerPixel);
    const offsetX = Math.floor((width - source.width) / 2);
    const offsetY = Math.floor((height - source.height) / 2);

    for (let row = 0; row < source.height; row++) {
        const targetRow = row + offsetY;
        if (targetRow < 0 || targetRow >= height) {
            continue;
        }
        const sourceStart = row * source.width * bytesPerPixel;
        const targetStart = (targetRow * width + offsetX) * bytesPerPixel;
        sourceBitmap.copy(canvas, targetStart, sourceStart, sourceStart + source.width * bytesPerPixel);
    }

    return nativeImage.createFromBitmap(canvas, { width, height });
}
