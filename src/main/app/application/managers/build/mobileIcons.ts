import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { nativeImage } from "electron";
import { decodePngToRgba, encodeOpaquePng, pngHasAlphaChannel } from "@shared/utils/pngOpaque";
import { scaleIconTo } from "./iconScaling";
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * PNG dimensions from the IHDR chunk, or null when it is not a readable PNG.
 *
 * IHDR is walked to rather than assumed to be first: Xcode rewrites the icons it
 * compiles into an app bundle with a private `CgBI` chunk ahead of it, and the
 * iOS shell template ships exactly those bytes. Reading only offset 12 saw
 * "CgBI" there and called every iOS icon slot unreadable, which failed the whole
 * build for any project that configured an app icon.
 */
export function readPngSize(bytes: Buffer): { width: number; height: number } | null {
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return null;
    }
    // Chunk layout: length (4) + type (4) + data (length) + CRC (4).
    for (let offset = 8; offset + 8 <= bytes.length;) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString("ascii", offset + 4, offset + 8);
        if (type === "IHDR") {
            if (offset + 16 > bytes.length) {
                return null;
            }
            const width = bytes.readUInt32BE(offset + 8);
            const height = bytes.readUInt32BE(offset + 12);
            return width > 0 && height > 0 ? { width, height } : null;
        }
        // A corrupt length would otherwise loop forever or read past the end.
        if (length > bytes.length) {
            return null;
        }
        offset += 12 + length;
    }
    return null;
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
 * a non-square source letterbox rather than stretch; see `scaleIconTo`, which
 * the desktop icon containers share. A project that has baked hands us an
 * already-opaque square, and one that has not gets the behaviour it had before.
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
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    const written: Record<string, string> = {};
    for (const [index, { slot, width, height }] of slots.entries()) {
        const fitted = scaleIconTo(source, width, height);
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
