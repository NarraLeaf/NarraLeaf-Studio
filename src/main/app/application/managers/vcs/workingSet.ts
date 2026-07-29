import fs from "fs/promises";
import path from "path";
import { isVersioned } from "@shared/vcs/workingSet";

/**
 * Enumerating the working set on disk.
 *
 * The POLICY - which paths belong under version control, and the ignore file that
 * makes the backend agree - lives in `@shared/vcs/workingSet`, because the renderer
 * asks the same question and a second copy of the exclusion table is the drift that
 * shows an author a file as protected while every commit leaves it out. Only the walk
 * is here, because only the walk needs a filesystem.
 *
 * Re-exported below so existing importers keep their path.
 */
export {
    isVersioned,
    renderWorkingSetIgnoreFile,
    workingSetIgnorePatterns,
} from "@shared/vcs/workingSet";

/**
 * Every versioned file under `root`, as ABSOLUTE paths.
 *
 * Absolute is not a style preference. Lore resolves a relative path against the
 * PROCESS working directory, which in an Electron main process is never the project
 * directory, and then silently ignores the result for being outside the repository -
 * success, nothing staged, and an author who believes their assets are protected.
 * Handing out absolute paths removes the opportunity.
 *
 * Directories are never descended into once excluded, so a project with a large
 * `node_modules` costs nothing to enumerate. Symlinks are reported as entries but
 * never followed: a link back up the tree would otherwise walk forever, and Lore
 * records a link as a node of its own rather than as its target.
 *
 * This is NOT how exclusion is enforced - staging hands Lore the repository root and
 * Lore applies the ignore file. This walk exists for the questions Studio has to
 * answer without asking the backend: how many files a first commit will contain,
 * which documents to normalise before that commit, and what a test should expect.
 */
export async function collectWorkingSet(root: string): Promise<string[]> {
    const found: string[] = [];
    await walk(root, "", found);
    return found;
}

async function walk(root: string, relative: string, found: string[]): Promise<void> {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (!isVersioned(childRelative)) continue;
        if (entry.isDirectory()) {
            await walk(root, childRelative, found);
        } else {
            found.push(path.join(root, childRelative));
        }
    }
}
