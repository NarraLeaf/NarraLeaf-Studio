import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { nativeImage } from "electron";
import { decodePngToRgba, encodeOpaquePng, pngHasAlphaChannel } from "@shared/utils/pngOpaque";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest.
import { parseZipIndex, readEntryBytes } from "../../../../buildWorker/mobile/zipModel";

/**
 * Scaling an author's app icon into the per-slot PNGs a shell template expects.
 *
 * The sizes are read from the template itself - each icon slot already holds a
 * placeholder PNG at exactly the size that slot needs (an Android density
 * bucket, an iOS @2x/@3x variant), so the replacement is scaled to match what
 * it replaces. That keeps the density/scale knowledge in the shell repo, where
 * it belongs: Studio would otherwise have to hardcode "mipmap-xxhdpi means 144
 * pixels", duplicating a mapping the template already states, and would silently
 * ship wrong-sized icons the day the shell adds a slot.
 *
 * Scaling happens here rather than in the worker because nativeImage is a
 * main-process API; the worker only ever sees the paths of the finished PNGs.
 */

export type MobileIconSlot = { slot: string; width: number; height: number };

/** PNG dimensions from the IHDR chunk, or null when it is not a readable PNG. */
export function readPngSize(bytes: Buffer): { width: number; height: number } | null {
    // PNG signature (8) + IHDR length/type (8) + width (4) + height (4).
    if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
        return null;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Read the size of every declared icon slot out of a template archive. A slot
 * the manifest declares but the template does not hold is an error: the two
 * disagree, and shipping the placeholder icon the author tried to replace would
 * be a silent wrong answer. (The repack enforces the same rule on its side.)
 */
export function readIconSlotSizes(templateZip: Buffer, slots: string[], entryPrefix = ""): MobileIconSlot[] {
    const index = parseZipIndex(templateZip);
    const byName = new Map(index.entries.map(entry => [entry.name, entry]));
    return slots.map(slot => {
        const entry = byName.get(`${entryPrefix}${slot}`);
        if (!entry) {
            throw new Error(`Icon slot "${slot}" is declared by the shell manifest but missing from the template`);
        }
        const size = readPngSize(readEntryBytes(templateZip, entry));
        if (!size) {
            throw new Error(`Icon slot "${slot}" in the shell template is not a readable PNG`);
        }
        return { slot, width: size.width, height: size.height };
    });
}

/**
 * Scale `sourceIconPath` into one PNG per slot under `outputDir`, returning the
 * slot → path map the worker's job takes. Slot paths become flat file names so
 * nested zip paths (res/mipmap-…/ic_launcher.png) cannot escape the directory
 * or collide.
 *
 * The scale preserves the source's aspect ratio and centres the result, letting
 * a non-square source letterbox rather than stretch. Passing nativeImage.resize
 * both a width and a height - which is what this did - makes it resize to
 * exactly those, so a 1000×500 logo arrived on the launcher squashed to a
 * square with no warning anywhere.
 *
 * Note what this does *not* do: it never composites onto a background. Flatten-
 * ing (which iOS requires, since the App Store rejects an icon with an alpha
 * channel) happens in the authoring bake, where a canvas does the blending with
 * known semantics; nativeImage's raw bitmaps are premultiplied on some
 * platforms and not others, and getting that wrong shows up as a halo nobody
 * would trace back to here. A project that has baked hands us an already-opaque
 * square, and one that has not gets the behaviour it had before.
 */
export async function writeScaledIcons(
    sourceIconPath: string,
    slots: MobileIconSlot[],
    outputDir: string,
    options: { opaque?: boolean } = {},
): Promise<Record<string, string>> {
    const source = nativeImage.createFromPath(sourceIconPath);
    if (source.isEmpty()) {
        throw new Error(`The app icon could not be read: ${sourceIconPath}`);
    }
    const sourceSize = source.getSize();
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    const written: Record<string, string> = {};
    for (const [index, { slot, width, height }] of slots.entries()) {
        const scale = Math.min(width / sourceSize.width, height / sourceSize.height);
        const drawWidth = Math.max(1, Math.round(sourceSize.width * scale));
        const drawHeight = Math.max(1, Math.round(sourceSize.height * scale));
        // "good" is nativeImage's highest-quality resampling - icons are
        // downscaled a long way (1024 → 48 at mdpi) and this is a one-off cost.
        const resized = source.resize({ width: drawWidth, height: drawHeight, quality: "good" });
        const fitted = drawWidth === width && drawHeight === height
            ? resized
            : centreOnTransparentCanvas(resized, width, height);
        const outputPath = path.join(outputDir, `${index}-${path.basename(slot)}`);
        // nativeImage.toPNG() always encodes RGBA, so an iOS icon that arrived
        // here alpha-free would leave with an alpha channel again - and be
        // rejected on upload for carrying one. Strip it back off.
        const png = options.opaque ? await stripAlphaChannel(fitted.toPNG()) : fitted.toPNG();
        await fs.writeFile(outputPath, png);
        written[slot] = outputPath;
    }
    return written;
}

/**
 * Re-encode a PNG without its alpha channel. Safe only because the pixels are
 * already opaque by the time this runs - the alpha lane is dropped, never
 * composited, so nothing has to know whether the bitmap was premultiplied.
 */
export async function stripAlphaChannel(png: Buffer): Promise<Buffer> {
    if (!pngHasAlphaChannel(png)) {
        return png;
    }
    const decoded = decodePngToRgba(png, data => zlib.inflateSync(data));
    const encoded = await encodeOpaquePng(
        decoded.rgba,
        decoded.width,
        decoded.height,
        data => zlib.deflateSync(data),
    );
    return Buffer.from(encoded);
}

/**
 * Place an image in the middle of a larger transparent square. A straight copy
 * of the pixel rows - no blending - so it is indifferent to whether the
 * platform's bitmaps carry premultiplied alpha.
 */
function centreOnTransparentCanvas(
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
