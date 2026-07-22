import type { FileStat } from "@shared/utils/fs";
import { extname, join } from "@shared/utils/path";
import { AssetExtensions, AssetType } from "./assetTypes";

/**
 * Minimal filesystem surface the path expander needs. Kept abstract so the directory recursion can
 * be unit tested against an in-memory tree without standing up the IPC/service stack.
 */
export interface ImportPathExpansionFs {
    /** Whether the path is a directory. Access errors resolve to `false` (treated as a plain file). */
    isDir(path: string): Promise<boolean>;
    /** Directory entries, or `null` when the directory cannot be read (skipped, not fatal). */
    list(path: string): Promise<FileStat[] | null>;
}

export interface ExpandImportPathsResult {
    /** De-duplicated file paths to import, in stable discovery order. */
    files: string[];
    /** True when at least one input path was a directory — drives the "nothing matched" message. */
    expandedDirectory: boolean;
}

/**
 * Guards against symlink/junction cycles and pathological trees. Asset folders are shallow in
 * practice, so a generous cap costs nothing and never truncates a real import.
 */
const MAX_DIRECTORY_DEPTH = 32;

/** Whether a filename's extension is importable as the given asset type. `Other` accepts everything. */
export function assetTypeMatchesExtension(type: AssetType, fileName: string): boolean {
    const allowed = AssetExtensions[type];
    if (allowed.includes("*")) {
        return true;
    }
    const ext = extname(fileName).replace(/^\./, "").toLowerCase();
    return ext.length > 0 && allowed.includes(ext);
}

/** Reconstruct a directory entry's full filename from the split {@link FileStat} shape. */
function entryFileName(entry: FileStat): string {
    return entry.ext ? `${entry.name}${entry.ext}` : entry.name;
}

/**
 * Expand a set of dropped paths into a flat list of importable files.
 *
 * Regular files pass through untouched, so individual drops keep their existing
 * validate-and-report behaviour. Directories are walked recursively and filtered to the files
 * matching `type`, so dropping a folder imports only the relevant assets and silently ignores the
 * rest.
 */
export async function expandImportPaths(
    type: AssetType,
    paths: string[],
    fs: ImportPathExpansionFs,
): Promise<ExpandImportPathsResult> {
    const files: string[] = [];
    const seen = new Set<string>();
    let expandedDirectory = false;

    const pushFile = (filePath: string): void => {
        if (!seen.has(filePath)) {
            seen.add(filePath);
            files.push(filePath);
        }
    };

    const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > MAX_DIRECTORY_DEPTH) {
            return;
        }
        const entries = await fs.list(dir);
        if (!entries) {
            return;
        }
        for (const entry of entries) {
            const name = entryFileName(entry);
            const childPath = join(dir, name);
            if (entry.type === "directory") {
                await walk(childPath, depth + 1);
            } else if (assetTypeMatchesExtension(type, name)) {
                pushFile(childPath);
            }
        }
    };

    // Classify the dropped top-level paths concurrently; a dropped selection can be large.
    const classified = await Promise.all(
        paths.map(async (path) => ({ path, isDir: await fs.isDir(path) })),
    );

    for (const { path, isDir } of classified) {
        if (isDir) {
            expandedDirectory = true;
            await walk(path, 0);
        } else {
            pushFile(path);
        }
    }

    return { files, expandedDirectory };
}
