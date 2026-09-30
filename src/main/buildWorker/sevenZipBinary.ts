/**
 * Where the bundled 7-Zip executable really is.
 *
 * `7zip-bin` answers that question with `path7za`, a value it computes once, at import, by joining
 * its own `__dirname` to the directory its platform and architecture are published under. That is
 * right when the module is loaded from `node_modules` and wrong every other way it can arrive.
 *
 * It can arrive two other ways here, and each breaks it differently:
 *
 *   - **Bundled.** esbuild inlines a package unless it is named in that bundle's `external` list, and
 *     an inlined `7zip-bin` computes its path from the *bundle's* directory. `dist/main/index.js`
 *     then looks for `dist/main/win/x64/7za.exe`, which has never existed, and the first thing that
 *     wants an extractor fails with a spawn ENOENT naming a path nothing ever put a file at. Two
 *     bundles have already been fixed by adding the package to their `external` list, which works
 *     but leaves the rule stated only as a comment in four esbuild configurations that have to agree.
 *   - **Inside an asar.** A packaged Studio resolves the package to `app.asar/node_modules/7zip-bin`,
 *     so the path names a file inside an archive. Electron's patched `fs` reports it as present, and
 *     what a spawn does with it depends on which process is asking - the build worker turns the asar
 *     patch off entirely (see {@link file://./enableNoAsar.ts}).
 *
 * So the path is rebuilt here rather than trusted: from where the package actually resolves to, and
 * through `unpackAsarPath` so it names the copy on disk. That makes it independent of which bundle
 * the calling module lands in - a question no caller should have to know the answer to, and the one
 * this got wrong twice.
 *
 * Comments in English per project convention.
 */

import { path7za } from "7zip-bin";
import { createRequire } from "module";
import path from "path";
import { unpackAsarPath } from "../utils/asarPath";

/**
 * How many trailing segments of `path7za` are the package's own answer rather than the directory it
 * believed it was in.
 *
 * The package composes every one of its three platform branches the same way -
 * `join(__dirname, <platform directory>, process.arch, <executable name>)` - so the last three
 * segments are the part that is right whatever the leading directory was. Read off the value rather
 * than recomputed from a table here, because a second table naming Windows `win` and macOS `mac`
 * would be a copy of the package's decision that could drift from it without anything noticing.
 */
const PUBLISHED_SUBPATH_SEGMENTS = 3;

/**
 * The absolute path of the bundled 7za, or the bare command name when the environment asks for the
 * host's own.
 *
 * A function rather than a constant so it is read at the point of use: the value depends on where
 * this module resolves the package from, and a caller in a test can be given the same answer the
 * build gets.
 */
export function sevenZipPath(): string {
    // `USE_SYSTEM_7ZA=true` makes the package answer with a bare command name, meaning "whatever
    // 7za is on PATH". That is a lookup rather than a location, and re-rooting it onto a directory
    // would turn the escape hatch into a path that resolves nowhere.
    if (!path.isAbsolute(path7za)) {
        return path7za;
    }
    return unpackAsarPath(path.join(sevenZipPackageDir(), ...publishedSubPath(path7za)));
}

/**
 * The directory the package occupies, as this process resolves it.
 *
 * `createRequire` rather than `__dirname`, which is exactly the mistake being corrected: the answer
 * has to come from where the package is, not from where the code asking happens to have been
 * bundled. Resolvable by construction - this module imports the package - and it yields the entry
 * file rather than the directory, so the package root is one level up. The package publishes no
 * `exports` map, so this is its `index.js` and not a subpath the resolver would refuse.
 */
function sevenZipPackageDir(): string {
    return path.dirname(createRequire(__filename).resolve("7zip-bin"));
}

/** The `<platform>/<arch>/<executable>` tail of a path the package composed. */
export function publishedSubPath(declared: string): string[] {
    return declared.split(/[\\/]/).slice(-PUBLISHED_SUBPATH_SEGMENTS);
}
