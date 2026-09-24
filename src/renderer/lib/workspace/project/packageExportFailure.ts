import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { isProjectPackageExportErrorCode, ProjectPackageExportErrorCode } from "@shared/types/projectPackage";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What the workspace says when File ▸ Export Project fails, from the code the main process answered
 * with.
 *
 * Main's own message is English and names the export folder and the project file that failed, which
 * is the log's business. A failure with no code this has words for - a disk error nobody can act on,
 * a grant the window never had - is said as the headline alone.
 */
export function describePackageExportFailure(code: string | undefined, t: Translate): string {
    const headline = t("actions.export.failed");
    const reason = packageExportFailureReason(code, t);
    return reason ? t("actions.export.failedWithReason", { headline, reason }) : headline;
}

function packageExportFailureReason(code: string | undefined, t: Translate): string | null {
    if (!isProjectPackageExportErrorCode(code)) {
        return null;
    }
    switch (code) {
        case ProjectPackageExportErrorCode.FolderProtected:
            return t("actions.export.reason.folderProtected");
        case ProjectPackageExportErrorCode.FolderReadOnly:
            return t("actions.export.reason.folderReadOnly");
        case ProjectPackageExportErrorCode.FolderMissing:
            return t("actions.export.reason.folderMissing");
        case ProjectPackageExportErrorCode.DiskFull:
            return t("actions.export.reason.diskFull");
        case ProjectPackageExportErrorCode.ProjectUnreadable:
            return t("actions.export.reason.projectUnreadable");
        case ProjectPackageExportErrorCode.ProjectFileBusy:
            return t("actions.export.reason.projectFileBusy");
        case ProjectPackageExportErrorCode.ProjectChanged:
            return t("actions.export.reason.projectChanged");
    }
}
