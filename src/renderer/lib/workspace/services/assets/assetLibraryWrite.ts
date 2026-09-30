import type { FsRequestResult } from "@shared/types/os";
import type { RequestStatus } from "@shared/types/ipcEvents";
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
 * out with the next change to the library, but nothing tries it in the meantime, and a folder edit
 * that could not be written is put back rather than kept. What is true the moment it fails is that
 * the change was not saved.
 */
export const ASSET_LIBRARY_WRITE = storeWrite("workspace.shell.save.stores.assets", "notRetried");

/**
 * The same write, for a folder edit whose caller puts up its own notice when it fails: the
 * save-status surface only logs it. See {@link AssetFolderWriteOptions}.
 */
export const ASSET_FOLDER_WRITE_REPORTED_BY_CALLER = storeWrite("workspace.shell.save.stores.assets", "handledByWriter");

/**
 * Who tells the author that a folder edit - a new folder, a renamed one - could not be written.
 *
 * One failure is one notice, and there are two surfaces that could give it. The save-status surface
 * can only say the asset library was not saved; the action that asked can say which change was lost,
 * and with the filesystem's code (the answer's `code`) why. So an action that names its change and
 * whose change is the one file it writes - the folder list, put back when the write fails - says it
 * itself, and asks for this. Everything else leaves it to the save-status surface: a drag, an undo,
 * and the gestures that write several of the library's files at once (a delete also rewrites the
 * records of every file it removed), whose failures that surface folds into one notice.
 */
export type AssetFolderWriteOptions = {
    callerReports?: boolean;
};

/**
 * The `code` a folder edit answers with when its write failed and the save-status surface has
 * already said so. A caller that lists what did not work (a paste, a delete) leaves such a row out:
 * the author has that notice in front of them, and naming the row again says one failure twice.
 */
export const ASSET_LIBRARY_WRITE_REPORTED = "ASSET_LIBRARY_WRITE_REPORTED";

/** The report a folder edit's write goes out with. */
export function assetFolderWriteReport(options?: AssetFolderWriteOptions) {
    return options?.callerReports ? ASSET_FOLDER_WRITE_REPORTED_BY_CALLER : ASSET_LIBRARY_WRITE;
}

/**
 * A folder edit's answer when its write failed: the filesystem's code for a caller that reports it,
 * {@link ASSET_LIBRARY_WRITE_REPORTED} for one that does not. The message is for the log.
 */
export function assetFolderWriteFailure(
    failure: FsRequestResult<void, false>,
    options?: AssetFolderWriteOptions,
): RequestStatus<never> {
    const error = failure.error;
    return {
        success: false,
        code: options?.callerReports ? error.code : ASSET_LIBRARY_WRITE_REPORTED,
        error: `Failed to save group: ${error.code} ${error.message}`,
    };
}
