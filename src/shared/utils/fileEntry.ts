/**
 * Decoding the split filename shape that directory listings travel in.
 *
 * `FsListHandler` (and the plugin-facing `privileged.fs.list`) do not hand back the filename they
 * read off disk. They split it: `name` is the stem with the extension removed, and the extension
 * moves to a separate `ext`. So a listing of `assets/` reports `logo.png` as
 * `{name: "logo", ext: ".png"}`, and anything that joins a child path from `name` alone addresses a
 * file that is not there.
 *
 * That failure is quiet rather than loud - the callers downstream of a listing treat an unreadable
 * path as "skip" or "zero bytes", so a wrong path shows up as understated data, not an error. The
 * asset overview shipped exactly that bug: every extension-bearing file counted as 0 bytes but +1
 * file, so the reported library size was silently low.
 *
 * Put the two halves back together with {@link entryFileName} before building a path, and split a
 * filename into that shape in the first place with {@link splitFileEntry} - the single factory both
 * listing surfaces (`FsListHandler` and the plugin-facing `privileged.fs.list`) construct entries
 * with, so the split lives in one place rather than two copies that can drift apart.
 *
 * The only import is `@shared/utils/path`, the pure separator polyfill both processes agree on. It
 * deliberately does *not* touch `@shared/utils/fs`: that module pulls in `fs/promises` and
 * `mime-types`, and the renderer only ever imports it for its types.
 */
import { parse } from "./path";

/**
 * The half of a directory entry this module cares about: a filename that arrived in two pieces.
 *
 * Structural rather than an import of `FileStat`, so the main-process `FileStat`, the renderer's
 * `DirEntry` (`@shared/utils/nlproj`), and any future listing shape all satisfy it without coupling
 * this module to any of them.
 */
export interface SplitFileEntry {
  /** Filename with the extension stripped off (`path.parse(name).name`). */
  name: string;
  /** Extension including the leading dot, or `null`/`""` when there is none. */
  ext: string | null;
}

/**
 * Reassemble a directory entry's full filename from its split parts.
 *
 * Accepts both conventions for "no extension" - `FsListHandler` normalizes to `null` while
 * {@link import("./fs").Fs.listFiles} leaves the empty string `path.extname` returns - because both
 * are falsy and a stem with nothing appended is the right answer either way.
 */
export function entryFileName(entry: SplitFileEntry): string {
  return entry.ext ? `${entry.name}${entry.ext}` : entry.name;
}

/** The split representation of a filename, with the whole filename kept alongside its two halves. */
export interface FileNameParts extends SplitFileEntry {
  /** The complete filename that was split, so a listing entry can carry it without rejoining. */
  fileName: string;
}

/**
 * Split a filename into the stem/extension pair a directory entry travels in, keeping the whole
 * filename beside them as `fileName`.
 *
 * This is the inverse of {@link entryFileName} and the one place the split is defined. Both listing
 * surfaces build their entries from it, so `name` (stem, extension stripped) stays byte-for-byte the
 * legacy value while `fileName` is added on top - the split cannot drift between the two callers
 * because there is only one.
 */
export function splitFileEntry(fileName: string): FileNameParts {
  const parsed = parse(fileName);
  return {
    name: parsed.name,
    ext: parsed.ext || null,
    fileName
  };
}
