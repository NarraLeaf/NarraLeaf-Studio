import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode, type FsRejectError } from "@shared/types/os";
import type { SavedFileName } from "../autosave/writeReport";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What a failed write means to an author, for the failures an author can do something about.
 *
 * A write that the disk refused carries a code (see `Fs.createError`) and the system's own message.
 * The message is for the log: it is English whatever the interface language is, and it names the
 * scratch file an atomic write renames from rather than the file the author knows. The code is what
 * the author can act on - make the file writable, put the folder back - so the codes that say one of
 * those things get a sentence here, and every other one answers null and is left to the log.
 */
export function describeWriteFailureReason(error: Pick<FsRejectError, "code">, t: Translate): string | null {
    switch (error.code) {
        case FsRejectErrorCode.PERMISSION_DENIED:
            return t("workspace.shell.save.reason.permissionDenied");
        case FsRejectErrorCode.NOT_FOUND:
            return t("workspace.shell.save.reason.folderMissing");
        case FsRejectErrorCode.NO_SPACE:
            return t("workspace.shell.save.reason.diskFull");
        default:
            return null;
    }
}

/**
 * The sentence a surface shows for a write the author asked for that did not land: the thing by its
 * name, then what the disk said when that is something to act on.
 *
 * For the surfaces that report their own writes (see `WriteFailureFollowUp`): an export, a text
 * file's save, a thumbnail. `name` is what the author knows the file as - the name they gave the
 * export, the asset's name, or a store's name - never the path it was written to, which for an
 * asset is its id split into folders. A bare string is a name the author gave.
 */
export function describeFileWriteFailure(
    name: SavedFileName | string,
    error: Pick<FsRejectError, "code">,
    t: Translate,
): string {
    const saved: SavedFileName = typeof name === "string" ? { item: name } : name;
    const reason = describeWriteFailureReason(error, t);
    if ("item" in saved) {
        return reason
            ? t("workspace.shell.save.fileFailed.withReason", { name: saved.item, reason })
            : t("workspace.shell.save.fileFailed.plain", { name: saved.item });
    }
    const store = t(saved.store);
    return reason
        ? t("workspace.shell.save.storeFailed.withReason", { name: store, reason })
        : t("workspace.shell.save.storeFailed.plain", { name: store });
}
