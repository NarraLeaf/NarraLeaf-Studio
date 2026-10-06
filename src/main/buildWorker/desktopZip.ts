import fsPromises from "fs/promises";
import path from "path";
import { FileZipOutput } from "./crossHost/archive";
import { writeParallelZip, type ArchiveItem } from "./parallelZip";

/**
 * A laid-out desktop app as a zip, the way electron-builder's zip target lays one out, but written
 * by {@link writeParallelZip} so it is compressed on every core rather than one per file.
 *
 * electron-builder puts a Windows or Linux app's files at the top of the archive, and a macOS app's
 * bundle as the one folder at the top (`Game.app/...`); {@link FolderZipOptions.topFolder} is the
 * difference. On a macOS or Linux host the zip keeps what those platforms need of a file beyond its
 * bytes - its permission bits, and a macOS framework's links - which is what electron-builder's
 * 7-Zip kept with `-snl`.
 */

export type FolderZipOptions = {
    /**
     * The permission bits for a file. Defaults to the file's own on a macOS or Linux host, and 0644
     * on Windows, which has none to read. A Linux app laid out on Windows reads them from content.
     */
    fileMode?: (absolute: string) => Promise<number> | number;
    /** The one folder every entry sits in, named after `root` - a macOS app bundle. */
    topFolder?: string;
    /** Timestamp stamped on every entry. Defaults to now. */
    mtime?: Date;
    /** Injected in tests; see {@link writeParallelZip}. */
    lanes?: number;
};

/** Write everything under `root` to `file`. */
export async function writeFolderZip(root: string, file: string, options: FolderZipOptions = {}): Promise<void> {
    const items = await folderArchiveItems(root, {
        ...(options.fileMode ? { fileMode: options.fileMode } : {}),
        ...(options.topFolder ? { topFolder: options.topFolder } : {}),
    });
    const output = await FileZipOutput.create(file);
    try {
        await writeParallelZip(output, items, {
            mtime: options.mtime ?? new Date(),
            ...(options.lanes !== undefined ? { lanes: options.lanes } : {}),
        });
    } finally {
        await output.close();
    }
}

export type FolderItemsOptions = Pick<FolderZipOptions, "fileMode" | "topFolder"> & {
    /**
     * Whether the folder's own permission bits mean anything. True on macOS and Linux; on Windows a
     * file's mode is invented by Node from its read-only flag, so files are 0644 and folders 0755.
     */
    posix?: boolean;
};

/**
 * Every directory, file and link under `root`, as archive items in name order - so a directory
 * always comes before what it holds, and the same folder makes the same archive.
 *
 * A link is kept as a link, never followed, and only when it stays inside the app: a macOS bundle's
 * frameworks are joined by relative links (`Versions/Current`), and storing those as copies leaves
 * a bundle codesign calls ambiguous. A link that leaves the folder - absolute, or climbing out of it -
 * is refused, because no laid-out app has one and keeping it would put a path on the author's machine
 * into the package.
 */
export async function folderArchiveItems(root: string, options: FolderItemsOptions = {}): Promise<ArchiveItem[]> {
    const posix = options.posix ?? process.platform !== "win32";
    const prefix = options.topFolder ? `${options.topFolder}/` : "";
    const items: ArchiveItem[] = [];
    if (options.topFolder) {
        const stats = await fsPromises.stat(root);
        items.push({ kind: "directory", name: prefix, mode: posix ? stats.mode & 0o777 : 0o755 });
    }
    const visit = async (relative: string): Promise<void> => {
        const absolute = relative ? path.join(root, ...relative.split("/")) : root;
        for (const entry of await fsPromises.readdir(absolute, { withFileTypes: true })) {
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const childAbsolute = path.join(absolute, entry.name);
            const stats = await fsPromises.lstat(childAbsolute);
            if (stats.isSymbolicLink()) {
                const target = await fsPromises.readlink(childAbsolute);
                if (!linkStaysInside(childRelative, target)) {
                    throw new Error(`${childAbsolute} links to ${target}, outside the app; a laid-out app has no such link.`);
                }
                items.push({ kind: "symlink", name: `${prefix}${childRelative}`, target, mode: posix ? stats.mode & 0o777 : 0o755 });
            } else if (stats.isDirectory()) {
                items.push({ kind: "directory", name: `${prefix}${childRelative}/`, mode: posix ? stats.mode & 0o777 : 0o755 });
                await visit(childRelative);
            } else if (stats.isFile()) {
                items.push({
                    kind: "file",
                    name: `${prefix}${childRelative}`,
                    mode: options.fileMode ? await options.fileMode(childAbsolute) : posix ? stats.mode & 0o777 : 0o644,
                    content: { kind: "disk", path: childAbsolute, size: stats.size },
                });
            } else {
                throw new Error(`${childAbsolute} is neither a file, a folder nor a link.`);
            }
        }
    };
    await visit("");
    return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Whether a link at `linkRelative` (a path inside the app, `/`-separated) pointing at `target` lands
 * inside the app. Read the way the platform that follows it will: relative to the link's own folder.
 */
export function linkStaysInside(linkRelative: string, target: string): boolean {
    if (target === "" || path.posix.isAbsolute(target) || path.win32.isAbsolute(target)) {
        return false;
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(linkRelative), target.replace(/\\/g, "/")));
    return resolved !== ".." && !resolved.startsWith("../");
}
