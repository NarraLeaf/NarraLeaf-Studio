import path from "node:path";

/**
 * The `app.asar.unpacked` twin of a path inside `app.asar`, or null when the
 * path is not inside an asar at all (every unpackaged run, where `dist/` is
 * already a real directory).
 *
 * electron-builder writes whatever `asarUnpack` matches to a sibling of the
 * archive named after it, so `.../app.asar/dist/main/buildWorker.js` is also on
 * disk at `.../app.asar.unpacked/dist/main/buildWorker.js`. Electron's patched
 * `fs` normally makes the two interchangeable and nothing needs to know - except
 * the one process that turns the patch off (see {@link file://./enableNoAsar.ts}),
 * which has to be *started* from the real path or nothing it requires resolves.
 *
 * `sep` is a parameter so the Windows shape can be tested from any host; it is
 * never passed in production.
 */
export function asarUnpackedPath(insideAsar: string, sep: string = path.sep): string | null {
    const segments = insideAsar.split(sep);
    // The *first* `.asar` segment: `app.asar` is the outermost archive, and a
    // path that somehow nested one inside another would still unpack beside the
    // outer one. Matched on a whole segment rather than a substring so a
    // directory merely called `asar-tools` cannot claim it.
    const asarIndex = segments.findIndex(segment => segment.toLowerCase().endsWith(".asar"));
    if (asarIndex === -1) {
        return null;
    }
    return segments.map((segment, index) => (index === asarIndex ? `${segment}.unpacked` : segment)).join(sep);
}
