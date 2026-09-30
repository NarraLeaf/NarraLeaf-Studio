import type { InterpolationParams, TranslationKey } from "@shared/i18n";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What an export failure says to the author.
 *
 * A failure that carries a filesystem code is worded from the code. Its message is Node's, and Node
 * quotes both paths - the source being the library's storage path, which is the asset's id split
 * into folders and names nothing the author knows. A failure without a code is one of the export's
 * own refusals ("This file is outside the project and was not exported."), which is a sentence
 * already and passes through.
 */
export function describeAssetExportFailure(
    failure: { code?: string; reason?: string | null },
    t: Translate,
): string {
    switch (failure.code) {
        case undefined:
            return failure.reason || t("assets.unknownError");
        case "EACCES":
        case "EPERM":
            return t("assets.export.reason.permissionDenied");
        case "ENOENT":
            return t("assets.export.reason.sourceMissing");
        case "ENOSPC":
            return t("assets.export.reason.diskFull");
        default:
            return t("assets.export.reason.copyFailed");
    }
}
