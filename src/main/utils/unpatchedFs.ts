import fsPromises from "fs/promises";
import { createRequire } from "module";

/**
 * `fs/promises` with Electron's asar patch left out.
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
function loadUnpatchedFsPromises(): typeof fsPromises {
    try {
        const originalFs = createRequire(__filename)("original-fs") as { promises?: typeof fsPromises };
        return originalFs.promises ?? fsPromises;
    } catch {
        return fsPromises;
    }
}

export const unpatchedFsPromises: typeof fsPromises = loadUnpatchedFsPromises();
