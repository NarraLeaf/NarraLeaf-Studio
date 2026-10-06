import fsPromises from "fs/promises";
import { parseZipIndex, readEntryBytes } from "../mobile/zipModel";
import type { ZipOutput } from "../mobile/zipWriter";
import { writeParallelZip, type ArchiveItem } from "../parallelZip";
import type { BundleEntry, BundleTree } from "../macBundle/bundleTree";

/**
 * Archives in and out of a {@link BundleTree}, for the packages Studio assembles without the target
 * platform's tools (see `hostPackagesWithoutPlatformTools`).
 *
 * The tree is read straight from Electron's release zip and written straight into the zip that
 * ships, so the symbolic links a macOS bundle needs and the permission bits a Linux executable needs
 * exist only inside archives - a Windows file system can hold neither.
 */

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

/**
 * Every entry of a zip as a tree, keeping each entry's unix mode and reading symbolic links as links.
 *
 * Electron's release zips are written on the platform they are for, so their modes are the real
 * ones: the executables' 0755, the frameworks' links.
 */
export async function readZipAsTree(zipPath: string): Promise<BundleTree> {
    const buffer = await fsPromises.readFile(zipPath);
    const index = parseZipIndex(buffer);
    const tree: BundleTree = new Map();
    for (const entry of index.entries) {
        const name = entry.name.replace(/\/$/, "");
        if (!name) {
            continue;
        }
        const type = entry.unixMode & S_IFMT;
        const mode = entry.unixMode & 0o7777;
        if (entry.isDirectory || type === S_IFDIR) {
            tree.set(name, { kind: "directory", mode: mode || 0o755 });
        } else if (type === S_IFLNK) {
            tree.set(name, { kind: "symlink", mode: mode || 0o755, target: readEntryBytes(buffer, entry).toString("utf8") });
        } else {
            tree.set(name, { kind: "file", mode: mode || 0o644, data: readEntryBytes(buffer, entry) });
        }
    }
    return tree;
}

/** A zip written to a file as it is produced, with the header fix-ups the writer asks for. */
export class FileZipOutput implements ZipOutput {
    private bytes = 0;

    private constructor(private readonly handle: fsPromises.FileHandle) {}

    public static async create(file: string): Promise<FileZipOutput> {
        return new FileZipOutput(await fsPromises.open(file, "w"));
    }

    public get position(): number {
        return this.bytes;
    }

    public async write(chunk: Buffer): Promise<void> {
        let offset = 0;
        while (offset < chunk.length) {
            const { bytesWritten } = await this.handle.write(chunk, offset, chunk.length - offset, this.bytes);
            offset += bytesWritten;
            this.bytes += bytesWritten;
        }
    }

    public async patch(offset: number, data: Buffer): Promise<void> {
        await this.handle.write(data, 0, data.length, offset);
    }

    public async close(): Promise<void> {
        await this.handle.close();
    }
}

/**
 * Write a tree as a zip: paths in sorted order, so a parent directory always precedes what it holds
 * and identical trees make identical archives. Large payload files stream from disk, and every file
 * is compressed on all cores (see parallelZip).
 */
export async function writeTreeAsZip(tree: BundleTree, file: string, mtime: Date): Promise<void> {
    const output = await FileZipOutput.create(file);
    try {
        const paths = [...tree.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const items = paths.map(path => archiveItemFor(path, tree.get(path) as BundleEntry));
        await writeParallelZip(output, items, { mtime });
    } finally {
        await output.close();
    }
}

function archiveItemFor(path: string, entry: BundleEntry): ArchiveItem {
    switch (entry.kind) {
        case "directory":
            return { kind: "directory", name: `${path}/`, mode: entry.mode };
        case "symlink":
            return { kind: "symlink", name: path, target: entry.target, mode: entry.mode };
        case "file":
            return { kind: "file", name: path, mode: entry.mode, content: { kind: "memory", data: entry.data } };
        case "diskFile":
            return { kind: "file", name: path, mode: entry.mode, content: { kind: "disk", path: entry.path, size: entry.size } };
    }
}
