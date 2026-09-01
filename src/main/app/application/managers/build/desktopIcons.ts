import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { nativeImage } from "electron";
import { decodePngToRgba } from "@shared/utils/pngOpaque";
import type { GameBuildDesktopPlatform } from "@shared/types/gameBuild";
import {
    ICNS_MINIMUM_EDGE,
    ICNS_SIZES,
    ICO_MINIMUM_EDGE,
    ICO_SIZES,
    encodeIcns,
    encodeIco,
    iconSizesFor,
    type IconImage,
} from "./iconContainers";
import { scaleIconTo } from "./iconScaling";

/**
 * Turning the project's app icon into the container each desktop platform's
 * packager wants, before the packager is ever started.
 *
 * ## Why Studio converts rather than electron-builder
 *
 * electron-builder will happily take a large PNG and convert it, and that is
 * what Studio used to hand it. The conversion runs a bundled script with
 * `process.execPath`, which inside Studio is the Electron binary - so packaging
 * one icon starts a second Electron. On a machine with no window server (an SSH
 * session on the build Mac, which is the whole reason `--build` exists) that
 * Electron dies on its GPU process, and the build fails with
 * `ERR_ELECTRON_BUILDER_CANNOT_EXECUTE` having already written the icon it was
 * asked for.
 *
 * Handed a file whose extension already matches the target format,
 * electron-builder returns it untouched and the converter never runs. So Studio
 * writes the `.ico` and the `.icns` itself, from `nativeImage` (in-process, no
 * subprocess, no display) and the encoders in `iconContainers.ts`.
 *
 * Linux is left alone: its icon "format" is a set of PNGs, and a PNG handed to
 * that target is likewise returned untouched.
 *
 * ## Why the results are cached
 *
 * The conversion is the same every time for the same source, and it used to run
 * on every build of every target. The containers are written under the project's
 * build scratch directory with a stamp describing the source they came from, so
 * a rebuild that has not changed the icon reuses them.
 */

/** Where a project's converted icons live, under its build scratch directory. */
export const DESKTOP_ICON_DIR = path.join(".nlstudio", "build", "desktop-icons");

/**
 * The container extension a platform's packager takes, or null when it wants the
 * PNG it was given.
 *
 * Linux is the null: `electron-builder` asks for the "set" format there, which a
 * single PNG already satisfies.
 */
export function desktopIconExtension(platform: GameBuildDesktopPlatform): ".ico" | ".icns" | null {
    switch (platform) {
        case "windows":
            return ".ico";
        case "macos":
            return ".icns";
        case "linux":
            return null;
    }
}

/**
 * What the stamp beside a converted icon records. A rebuild reuses the container
 * only when all of it still matches.
 *
 * The source's size and modification time rather than a hash of its bytes: the
 * file can be tens of megabytes, this runs on every build, and an author who
 * rewrites an icon with the same length to the same millisecond has done
 * something no filesystem timestamp was ever going to catch.
 *
 * `version` is this module's own. It is what makes a Studio update that changes
 * which sizes go into a container re-convert rather than keep serving a
 * container built to the old table.
 */
type DesktopIconStamp = {
    version: number;
    source: string;
    bytes: number;
    modifiedMs: number;
    /** The sizes that went in, so a changed table invalidates even at one version. */
    sizes: number[];
};

const STAMP_VERSION = 1;

export type DesktopIconResult = {
    /** Absolute path of the file to hand the packager. */
    iconPath: string;
    /** True when the source was already in the target format and was passed through. */
    passedThrough: boolean;
    /** True when the container was reused from a previous build. */
    reused: boolean;
};

/**
 * The icon file to hand the packager for one desktop platform.
 *
 * `sourceIconPath` is the PNG the project resolved (or Studio's own fallback
 * mark). A source that is already in the target format is passed through
 * untouched - `getDefaultGameIconPath` can answer with an `.ico`, and an author
 * may point the project at a container they made themselves.
 *
 * Throws if the source cannot be read or the container cannot be written. The
 * caller decides what to do about it; see `GameBuildManager.resolveTargetIcon`,
 * which falls back rather than failing the build over an icon.
 */
export async function ensureDesktopIcon(input: {
    sourceIconPath: string;
    platform: GameBuildDesktopPlatform;
    /** The project root; the container is written under its build scratch directory. */
    projectPath: string;
}): Promise<DesktopIconResult> {
    const extension = desktopIconExtension(input.platform);
    if (!extension) {
        return { iconPath: input.sourceIconPath, passedThrough: true, reused: false };
    }
    if (path.extname(input.sourceIconPath).toLowerCase() === extension) {
        return { iconPath: input.sourceIconPath, passedThrough: true, reused: false };
    }

    const source = nativeImage.createFromPath(input.sourceIconPath);
    if (source.isEmpty()) {
        throw new Error(`The app icon could not be read: ${input.sourceIconPath}`);
    }
    const sourceSize = source.getSize();
    const sourceEdge = Math.max(sourceSize.width, sourceSize.height);
    const sizes = extension === ".ico"
        ? iconSizesFor(ICO_SIZES, sourceEdge, ICO_MINIMUM_EDGE)
        : iconSizesFor(ICNS_SIZES, sourceEdge, ICNS_MINIMUM_EDGE);

    const outputDir = path.join(input.projectPath, DESKTOP_ICON_DIR, input.platform);
    const iconPath = path.join(outputDir, `icon${extension}`);
    const stampPath = `${iconPath}.stamp.json`;
    const stat = await fs.stat(input.sourceIconPath);
    const stamp: DesktopIconStamp = {
        version: STAMP_VERSION,
        source: path.resolve(input.sourceIconPath),
        bytes: stat.size,
        modifiedMs: Math.round(stat.mtimeMs),
        sizes,
    };
    if (await stampMatches(stampPath, iconPath, stamp)) {
        return { iconPath, passedThrough: false, reused: true };
    }

    // Only the .ico writer needs samples, and only for the sizes it stores as
    // bitmaps - but decoding is cheap next to the resize that produced them, and
    // one shape for both containers is one thing to get wrong.
    const images: IconImage[] = sizes.map(size => {
        const png = scaleIconTo(source, size, size).toPNG();
        return { size, png, rgba: decodePngToRgba(png, data => zlib.inflateSync(data)).rgba };
    });
    const container = extension === ".ico" ? encodeIco(images) : encodeIcns(images);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(iconPath, container);
    await fs.writeFile(stampPath, `${JSON.stringify(stamp, null, 2)}\n`, "utf8");
    return { iconPath, passedThrough: false, reused: false };
}

/**
 * Whether the container on disk was made from exactly this source with exactly
 * this size table.
 *
 * Anything unreadable is a miss rather than a failure: the answer to a stamp
 * that will not parse is to convert again, which costs a second.
 */
async function stampMatches(stampPath: string, iconPath: string, stamp: DesktopIconStamp): Promise<boolean> {
    try {
        const [recorded] = await Promise.all([
            fs.readFile(stampPath, "utf8"),
            fs.access(iconPath),
        ]);
        const previous = JSON.parse(recorded) as DesktopIconStamp;
        return previous.version === stamp.version
            && previous.source === stamp.source
            && previous.bytes === stamp.bytes
            && previous.modifiedMs === stamp.modifiedMs
            && Array.isArray(previous.sizes)
            && previous.sizes.length === stamp.sizes.length
            && previous.sizes.every((size, index) => size === stamp.sizes[index]);
    } catch {
        return false;
    }
}
