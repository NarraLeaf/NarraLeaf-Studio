import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { describeAssetFieldFailure } from "@/lib/ui-editor/runtime/assetResolution";
import { ASSET_UNDECODABLE, READ_NEWER_VERSION } from "../services/assets/assetReadFailure";

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/**
 * What an editor says in place of an asset it opened and could not read - the preview of an image, a
 * clip, a font, a JSON file; a thumbnail picked from the library.
 *
 * The first half is the same three facts the inspector's field line and Dev Mode's issue list tell
 * apart (see `describeAssetFieldFailure`): no longer in this project, could not be read (by name), or
 * not an asset. When the project still has the asset, the second half says what the read answered,
 * for the answers an author can act on: its file is gone from the project folder, Studio may not
 * read it, or it is there and cannot be opened.
 *
 * Never the read's own message. It is English whatever the interface speaks, and it names the
 * asset's storage path - its id split into folders - or, for a decode, whatever the browser said.
 *
 * `knownName` is what the project calls the asset now, or null when the library has no record of it.
 * `code` is the read's `RequestStatus.code`: a filesystem code, {@link ASSET_UNDECODABLE}, or nothing.
 */
export function describeAssetReadFailure(
    requested: string,
    knownName: string | null,
    code: string | undefined,
    t: Translate,
): string {
    const headline = describeAssetFieldFailure(requested, knownName, t);
    if (!knownName) {
        return headline;
    }
    return withReadFailureReason(headline, code, t);
}

/**
 * `headline` followed by what a read answered, for the answers an author can act on: the file is
 * gone from the project folder, Studio may not read it, it is there and cannot be opened, or a newer
 * Studio saved it. The reasons speak of "its file", so they serve anything the project keeps in one -
 * a story, a motion or a translation table as well as an asset.
 */
export function withReadFailureReason(headline: string, code: string | undefined, t: Translate): string {
    const reason = readFailureReason(code, t);
    return reason ? t("assets.reference.withReason", { headline, reason }) : headline;
}

function readFailureReason(code: string | undefined, t: Translate): string | null {
    switch (code) {
        case FsRejectErrorCode.NOT_FOUND:
            return t("assets.reference.reason.fileMissing");
        case FsRejectErrorCode.PERMISSION_DENIED:
            return t("assets.reference.reason.accessDenied");
        case ASSET_UNDECODABLE:
            return t("assets.reference.reason.undecodable");
        case READ_NEWER_VERSION:
            return t("assets.reference.reason.newerVersion");
        default:
            return null;
    }
}
