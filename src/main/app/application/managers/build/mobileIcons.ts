import fs from "fs/promises";
import path from "path";
import { nativeImage } from "electron";
// Relative on purpose: "@/" means src/main here but src/renderer under vitest.
import { parseZipIndex, readEntryBytes } from "../../../../buildWorker/mobile/zipModel";

/**
 * Scaling an author's app icon into the per-slot PNGs a shell template expects.
 *
 * The sizes are read from the template itself — each icon slot already holds a
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
 */
export async function writeScaledIcons(
    sourceIconPath: string,
    slots: MobileIconSlot[],
    outputDir: string,
): Promise<Record<string, string>> {
    const source = nativeImage.createFromPath(sourceIconPath);
    if (source.isEmpty()) {
        throw new Error(`The app icon could not be read: ${sourceIconPath}`);
    }
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    const written: Record<string, string> = {};
    for (const [index, { slot, width, height }] of slots.entries()) {
        // "good" is nativeImage's highest-quality resampling — icons are
        // downscaled a long way (512 → 48 at mdpi) and this is a one-off cost.
        const resized = source.resize({ width, height, quality: "good" });
        const outputPath = path.join(outputDir, `${index}-${path.basename(slot)}`);
        await fs.writeFile(outputPath, resized.toPNG());
        written[slot] = outputPath;
    }
    return written;
}
