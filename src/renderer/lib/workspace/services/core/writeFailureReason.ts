import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode, type FsRejectError } from "@shared/types/os";

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
