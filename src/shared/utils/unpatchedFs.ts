import nodeFs from "fs";
import { createRequire } from "module";

/**
 * `fs` with Electron's asar patch left out.
 *
 * Electron rewrites the `fs` module in every process it starts, main and utility processes alike,
 * so that a path running through a FILE whose name ends in ".asar" is served from inside that
 * archive instead of being read as the file it is. That is what makes Studio's own resources
 * reachable in a packaged build, and it is wrong for anything that touches a folder an author owns:
 * a project that still holds a packaged game, a backup, or a game that ships an archive of its own.
 *
 * What the patch does to such a file, measured on Electron 38 for Windows (a real archive made with
 * `@electron/asar`, and a folder named `old.asar/` beside it):
 *
 * - **Reading it fails, and so does copying it.** `readFile`, `open`, `copyFile`, `createReadStream`
 *   and `access` all answer `ENOENT,  not found in <that same file>` - a lookup for the empty path
 *   inside the archive, with nothing to tell the author their file is there. A file that only
 *   looks like an archive answers `Invalid package <file>` instead, from `stat` as well.
 * - **`stat` calls it a directory** of size 0, and `readdir` lists what is inside the archive, so a
 *   walk that asks `stat` steps into the file and reports the archive's contents as the author's.
 * - **It cannot be deleted by name.** `rm` answers EISDIR for the file, and a recursive `rm` of a
 *   folder holding one fails.
 * - **`promises.cp` refuses any tree that holds one** (`Invalid package <destination>`).
 * - **Looking at it once locks it for the life of the process.** The patch keeps every archive it
 *   opened open, and on Windows an open file cannot be renamed over or deleted - by Studio or by
 *   anything else on the machine. One `stat` is enough, so every read has to avoid the patch, not
 *   only the ones that would have failed.
 * - **A folder named like an archive is only safe while it already exists.** The patch asks once
 *   per path whether it is a directory and remembers the answer until the process exits. So
 *   `mkdir -p x.asar/sub` fails with ENOTDIR when `x.asar` is not there yet, and a path that was
 *   first asked about before its folder existed - a restore that recreates it, a copy that creates
 *   it - reads as a broken archive (`Invalid package`) from then on.
 *
 * `original-fs` is the same module before the patch, and it exists only inside Electron, where its
 * recursive operations (`cp`, `rm`) are built on unpatched internals too. Under plain node - tests,
 * tooling - the patch was never applied, so `fs` is already the unpatched module and the fallback is
 * exact rather than approximate.
 *
 * One operation is not clean even here: `readdir(dir, { recursive: true })` without `withFileTypes`
 * still steps into an archive and fails with ENOTDIR. Walk with `withFileTypes`, or by hand.
 *
 * **The rule this module exists for**: a file an author owns - anything under a project folder, a
 * folder they picked, a package or plugin folder they handed over - is reached through here. The one
 * thing that needs the patched `fs` is Studio's own archive (`app.getAppPath()` in a packaged build:
 * the `dist` bundles, `public`, `package.json`), and code reading those says so where it does it.
 *
 * Toggling `process.noAsar` would be the other way to do this, and it is not usable in a process that
 * also reads its own archive: the flag is process-wide, so holding it across an await would also
 * unhook the reads Studio makes of its own archive on any other task that happens to run meanwhile.
 * Only a process that never reads the archive - the game build worker - turns it off.
 */
function loadUnpatchedFs(): typeof nodeFs {
    try {
        return createRequire(__filename)("original-fs") as typeof nodeFs;
    } catch {
        return nodeFs;
    }
}

/** The whole module, for the callback, sync and stream APIs. */
export const unpatchedFs: typeof nodeFs = loadUnpatchedFs();

/** The promise API of the same module, which is what most callers want. */
export const unpatchedFsPromises: typeof nodeFs.promises = unpatchedFs.promises;
