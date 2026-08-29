import nodeFs from "fs";
import { createRequire } from "module";

/**
 * `fs` with Electron's asar patch left out.
 *
 * Electron rewrites every `fs` entry point so that a path containing ".asar" is served from inside
 * that archive instead of being read as the file it is. That is what makes Studio's own resources
 * reachable in a packaged build, and it is wrong for anything that walks a folder an author owns: a
 * project that still holds a packaged game reaches `.../Resources/default_app.asar`, and reading it
 * fails with `ENOENT,  not found in <that same file>` - the patch looked up the empty path inside
 * the archive rather than opening it. Writing is affected the same way, so a package carrying such
 * a file cannot be unpacked either.
 *
 * `original-fs` is the same module before the patch, and it exists only inside Electron. Under
 * plain node - tests, tooling - the patch was never applied, so `fs` is already the unpatched
 * module and the fallback is exact rather than approximate.
 *
 * Toggling `process.noAsar` would be the other way to do this, and it is not usable here: the flag
 * is process-wide, so holding it across an await would also unhook the reads Studio makes of its
 * own archive on any other task that happens to run meanwhile.
 */
function loadUnpatchedFs(): typeof nodeFs {
    try {
        return createRequire(__filename)("original-fs") as typeof nodeFs;
    } catch {
        return nodeFs;
    }
}

/** The whole module, for the callback and stream APIs. */
export const unpatchedFs: typeof nodeFs = loadUnpatchedFs();

/** The promise API of the same module, which is what most callers want. */
export const unpatchedFsPromises: typeof nodeFs.promises = unpatchedFs.promises;
