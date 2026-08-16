/**
 * Point at the unpacked copy when a path resolves inside an asar archive.
 *
 * A native library cannot be dlopen'd from inside asar, and nothing can be copied out of one that
 * was never unpacked. `electron-builder.yml` already unpacks `node_modules`, so such a file is on
 * disk under `app.asar.unpacked` - but `require.resolve` still reports the archive path, which is
 * why every caller that means the file on disk has to go through here.
 *
 * Comments in English per project convention.
 */

export function unpackAsarPath(libraryPath: string): string {
    return libraryPath.replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
}
