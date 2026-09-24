import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import type { FsRejectErrorCode } from "@shared/types/os";
import { describeWriteFailureReason } from "@/lib/workspace/services/core/writeFailureReason";
import { ASSET_LIBRARY_WRITE_REPORTED } from "@/lib/workspace/services/assets/assetLibraryWrite";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/** What the asset panel's notice for one failed action says: its title, and the reason under it. */
export type AssetActionNotice = {
    message: string;
    detail?: string;
};

/**
 * The notice for a folder edit that reports its own write failure - a new folder, a renamed one (see
 * `AssetFolderWriteOptions`): `title` names the action, and the line under it is what the disk said,
 * for the answers an author can act on.
 *
 * The one notice the author sees for it. The write went out as the caller's to report, so the
 * save-status surface only logged it; a failure that did not come from the write (a folder that was
 * deleted meanwhile) has no reason an author can act on, and gets the title alone. Never the answer's
 * `error`, which is the log's.
 */
export function describeFolderEditFailure(
    title: string,
    result: { code?: string },
    t: Translate,
): AssetActionNotice {
    const reason = result.code
        ? describeWriteFailureReason({ code: result.code as FsRejectErrorCode }, t)
        : null;
    return reason ? { message: title, detail: reason } : { message: title };
}

/**
 * Whether a row of a paste or a delete failed only because the library's own file could not be
 * written - which the save-status surface has already said, under one title for the whole gesture.
 * Such a row is left out of the gesture's own list rather than named a second time.
 */
export function isReportedLibraryWrite(result: { code?: string }): boolean {
    return result.code === ASSET_LIBRARY_WRITE_REPORTED;
}
