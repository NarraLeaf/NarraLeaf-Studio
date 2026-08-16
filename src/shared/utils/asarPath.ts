/**
 * Point at the unpacked copy when a path resolves inside an asar archive.
 *
 * A native library cannot be dlopen'd from inside asar, and nothing can be read out of one that was
 * never unpacked. `asarUnpack` puts such a file on disk under `app.asar.unpacked` - but the path a
 * caller computes from `__dirname`, or that `require.resolve` reports, still names the archive.
 * Every caller that means the file on disk goes through here.
 *
 * Shared rather than main-only because both processes that load a native addon need it: Studio's
 * main process resolving its own dependencies, and the packaged game's main process reaching the
 * copy that shipped beside it.
 *
 * Comments in English per project convention.
 */

export function unpackAsarPath(libraryPath: string): string {
    return libraryPath.replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
}
