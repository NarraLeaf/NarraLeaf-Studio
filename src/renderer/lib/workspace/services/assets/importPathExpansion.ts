import { entryFileName } from "@shared/utils/fileEntry";
import type { FileStat } from "@shared/utils/fs";
import { extname, join } from "@shared/utils/path";
import { AssetExtensions, AssetType, isBundleAssetType } from "./assetTypes";

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
    if (isBundleAssetType(type)) {
        return expandBundleImportPaths(paths, fs);
    }

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

/**
 * The bundle-type inversion of the walk above: a dropped **directory** is the unit to import, and it
 * is passed through whole. Nothing is walked and nothing is filtered.
 *
 * This is the opposite of what every other type wants from the same gesture, and it has to be:
 * walking a model folder and filtering by extension is precisely the behaviour that turns one
 * character into eighteen loose files with every internal reference broken.
 *
 * Dropped *files* are dropped, not imported as single-file bundles: a lone `.model3.json` without
 * the tree it names is not a model, and importing one would produce an asset that 404s every
 * texture at mount time.
 */
async function expandBundleImportPaths(
    paths: string[],
    fs: ImportPathExpansionFs,
): Promise<ExpandImportPathsResult> {
    const classified = await Promise.all(
        paths.map(async (path) => ({ path, isDir: await fs.isDir(path) })),
    );

    const directories: string[] = [];
    const seen = new Set<string>();
    for (const { path, isDir } of classified) {
        if (isDir && !seen.has(path)) {
            seen.add(path);
            directories.push(path);
        }
    }

    // `expandedDirectory` drives the "nothing matched" notice. Reported as true whenever a directory
    // was dropped, so a folder that yielded nothing importable still reads as "that folder had
    // nothing", not as a silent no-op.
    return { files: directories, expandedDirectory: classified.some(entry => entry.isDir) };
}
