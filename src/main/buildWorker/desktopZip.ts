import fsPromises from "fs/promises";
import path from "path";
import { FileZipOutput } from "./crossHost/archive";
import { writeParallelZip, type ArchiveItem } from "./parallelZip";

/**
 * A laid-out desktop app as a zip, the way electron-builder's zip target lays one out - the app's
 * files at the top of the archive, no folder around them - but written by {@link writeParallelZip}
 * so it is compressed on every core rather than one per file.
 */

export type FolderZipOptions = {
    /** The permission bits for a file. Defaults to 0644; a Linux app reads them from each file's content. */
    fileMode?: (absolute: string) => Promise<number> | number;
    /** Timestamp stamped on every entry. Defaults to now. */
    mtime?: Date;
    /** Injected in tests; see {@link writeParallelZip}. */
    lanes?: number;
};

/** Write everything under `root` to `file`. */
export async function writeFolderZip(root: string, file: string, options: FolderZipOptions = {}): Promise<void> {
    const items = await folderArchiveItems(root, options.fileMode ?? (() => 0o644));
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

/**
 * Every directory and file under `root`, as archive items in name order - so a directory always
 * comes before what it holds, and the same folder makes the same archive.
 *
 * A link is refused rather than followed: an app laid out on this machine has none (a macOS bundle,
 * whose frameworks are joined by links, is archived from its tree by `writeTreeAsZip`), and following
 * one could put something outside the app into the package.
 */
export async function folderArchiveItems(
    root: string,
    fileMode: (absolute: string) => Promise<number> | number,
): Promise<ArchiveItem[]> {
    const items: ArchiveItem[] = [];
    const visit = async (relative: string): Promise<void> => {
        const absolute = relative ? path.join(root, ...relative.split("/")) : root;
        for (const entry of await fsPromises.readdir(absolute, { withFileTypes: true })) {
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            const childAbsolute = path.join(absolute, entry.name);
            if (entry.isDirectory()) {
                items.push({ kind: "directory", name: `${childRelative}/`, mode: 0o755 });
                await visit(childRelative);
            } else if (entry.isFile()) {
                const { size } = await fsPromises.stat(childAbsolute);
                items.push({
                    kind: "file",
                    name: childRelative,
                    mode: await fileMode(childAbsolute),
                    content: { kind: "disk", path: childAbsolute, size },
                });
            } else {
                throw new Error(`${childAbsolute} is neither a file nor a folder; a package laid out on this machine has no links.`);
            }
        }
    };
    await visit("");
    return items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
