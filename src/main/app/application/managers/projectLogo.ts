import fs from "fs/promises";
import path from "path";
import { nativeImage } from "electron";
import { readProjectIconSet, type ProjectIconSet } from "@shared/types/projectIcons";
import { decodeProjectConfig, findProjectConfigFileName, type DirEntry } from "@shared/utils/nlproj";

/**
 * A project's own app icon, as a `data:` URL Studio's surfaces can draw.
 *
 * The launcher's project list and the title bar's switcher used to label every project with a
 * two-letter monogram, including the ones that ship a logo. The logo is right there in the
 * project - `metadata.icons`, the master the author imported in Project ▸ Assets - so the list
 * shows it and falls back to the monogram only when there is nothing to show.
 *
 * Read here rather than remembered in the history for the same reason plugin icons are not stored
 * in the store index: the history is persisted global state, rewritten on every open and
 * broadcast to every window, and putting a few hundred kilobytes of base64 per project in it
 * would make each of those writes expensive - and still show yesterday's logo. Reading the
 * project answers with what it holds now.
 *
 * Never throws. A project we cannot read, one that has no icon, or one whose icon is in a format
 * no browser can draw all answer `null`, which is the monogram - the behaviour every project had
 * before this existed.
 */

/** Longest edge of the thumbnail handed to a renderer. Twice the largest tile, for HiDPI. */
const THUMBNAIL_EDGE = 128;

/**
 * Cap on what is read off disk for one icon. A master is a logo, not artwork - anything past this
 * is a file that was never meant to be an app icon, and decoding it would cost the whole list.
 */
const MAX_ICON_BYTES = 8 * 1024 * 1024;

/**
 * Cap on an icon that is passed through verbatim rather than downscaled (see
 * {@link toThumbnailDataUrl}). Lower, because these bytes travel over IPC as they are.
 */
const MAX_PASSTHROUGH_BYTES = 512 * 1024;

/**
 * Media types a renderer's `<img>` can draw, for the formats `nativeImage` cannot decode. SVG is
 * safe in this position: an `<img>` neither runs script in it nor fetches what it references.
 */
const PASSTHROUGH_MEDIA_TYPES = new Set(["image/svg+xml", "image/webp", "image/x-icon"]);

/** The project's logo as a `data:` URL, or `null` when it has none we can draw. */
export async function readProjectLogo(projectPath: string): Promise<string | null> {
    try {
        const set = await readIconSet(projectPath);
        if (!set) {
            return null;
        }

        // The master first: it is the logo the author supplied, and what the Assets panel shows
        // back to them. The baked desktop PNG is the fallback for a master in a format no browser
        // draws - an `.icns`, which the picker accepts - since a bake is always a PNG.
        const candidates: { relativePath: string; mediaType: string }[] = [];
        if (set.master) {
            candidates.push({ relativePath: set.master.path, mediaType: set.master.mediaType });
        }
        const bakedDesktop = set.baked.windows ?? set.baked.macos ?? set.baked.linux;
        if (bakedDesktop) {
            candidates.push({ relativePath: bakedDesktop.path, mediaType: "image/png" });
        }

        for (const candidate of candidates) {
            const iconPath = resolveInsideProject(projectPath, candidate.relativePath);
            if (!iconPath) {
                continue;
            }
            const bytes = await readBoundedFile(iconPath);
            const dataUrl = bytes && toThumbnailDataUrl(bytes, candidate.mediaType);
            if (dataUrl) {
                return dataUrl;
            }
        }
        return null;
    } catch (error) {
        console.warn(`[projectLogo] ${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/** The project's `metadata.icons`, read straight off its `.nlproj`, or null when there is none. */
async function readIconSet(projectPath: string): Promise<ProjectIconSet | null> {
    let entries: DirEntry[];
    try {
        entries = (await fs.readdir(projectPath, { withFileTypes: true })).map(entry => ({
            name: path.parse(entry.name).name,
            ext: path.extname(entry.name) || null,
            type: entry.isDirectory() ? "directory" : "file",
        }));
    } catch {
        // Gone, offline, or not ours to read. The list already says so in its own way.
        return null;
    }

    const configFileName = findProjectConfigFileName(entries);
    if (!configFileName) {
        return null;
    }
    const bytes = await readBoundedFile(path.join(projectPath, configFileName));
    return bytes ? readProjectIconSet(decodeProjectConfig(bytes)) : null;
}

/**
 * The absolute path of a project-relative icon, or `null` when it points outside the project.
 *
 * The relative path comes out of a file on disk, and a project can be one the user was handed. It
 * decides what gets read, so it is checked rather than trusted: without this, `../../..` in a
 * manifest would turn a list of projects into a file reader.
 */
function resolveInsideProject(projectPath: string, relativePath: string): string | null {
    if (!relativePath.trim() || path.isAbsolute(relativePath)) {
        return null;
    }
    const root = path.resolve(projectPath);
    const resolved = path.resolve(root, relativePath);
    return resolved.startsWith(root + path.sep) ? resolved : null;
}

/** A file's bytes, or `null` when it is missing, unreadable, or past {@link MAX_ICON_BYTES}. */
async function readBoundedFile(filePath: string): Promise<Buffer | null> {
    try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile() || stats.size > MAX_ICON_BYTES) {
            return null;
        }
        return await fs.readFile(filePath);
    } catch {
        return null;
    }
}

/**
 * Icon bytes as a `data:` URL small enough to send to every window that lists projects.
 *
 * A master bakes at 1024 and is often bigger, so it is decoded and downscaled to
 * {@link THUMBNAIL_EDGE} - a tile is 40 CSS pixels, and shipping a megabyte of base64 per row to
 * draw one is the kind of cost that only shows up on a list of twenty.
 *
 * `nativeImage` reads PNG and JPEG and nothing else, which leaves the formats the icon picker also
 * accepts: SVG, WebP and ICO. Those are passed through as they are - all three are things a
 * renderer draws, and all three are small in practice, so the cap is what keeps that true.
 */
function toThumbnailDataUrl(bytes: Buffer, mediaType: string): string | null {
    const image = nativeImage.createFromBuffer(bytes);
    if (!image.isEmpty()) {
        const { width, height } = image.getSize();
        const longest = Math.max(width, height);
        // Both dimensions are given, scaled together: `resize` with one of each would fit the
        // canvas exactly and squash a logo that is not square.
        const scaled = longest > THUMBNAIL_EDGE
            ? image.resize({
                width: Math.max(1, Math.round((width * THUMBNAIL_EDGE) / longest)),
                height: Math.max(1, Math.round((height * THUMBNAIL_EDGE) / longest)),
                quality: "good",
            })
            : image;
        return `data:image/png;base64,${scaled.toPNG().toString("base64")}`;
    }

    if (PASSTHROUGH_MEDIA_TYPES.has(mediaType) && bytes.byteLength <= MAX_PASSTHROUGH_BYTES) {
        return `data:${mediaType};base64,${bytes.toString("base64")}`;
    }
    return null;
}
