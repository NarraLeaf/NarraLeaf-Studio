import { storeWrite } from "../autosave/writeReport";

/**
 * How a write to the asset library's own files - the metadata shards, the folder lists, the row
 * order - is reported when it fails.
 *
 * All three are "the asset library" to the author, who never sees them apart: one new folder writes
 * a folder list and a row order, and a read-only `assets` folder refuses both, which the save-status
 * surface then reports as one failure rather than two.
 *
 * `notRetried`, because no saver writes these. A shard that could not be written stays owed and goes
 * out with the next change to the library, but nothing tries it in the meantime, and a folder rename
 * that could not be written is put back rather than kept. What is true the moment it fails is that
 * the change was not saved.
 */
export const ASSET_LIBRARY_WRITE = storeWrite("workspace.shell.save.stores.assets", "notRetried");
