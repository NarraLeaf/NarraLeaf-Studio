import type { InterpolationParams, TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import { PSD_UNREADABLE } from "@shared/types/psdImport";
import { withReadFailureReason } from "@/lib/workspace/assets/assetReadFailure";
import { ASSET_UNDECODABLE } from "@/lib/workspace/services/assets/assetReadFailure";

/**
 * What the wizard says when a step failed: `headline`, then why, for the two answers an author can act
 * on - Studio may not read the file, or it is not a PSD this reader opens.
 *
 * Never the failure's own message. It is the parser's English ("Invalid signature"), or Node's with
 * the file's full path in it, or a worker's that exited mid-bake - and the request's `code` is what
 * says which of those is worth a sentence. "Missing from the project folder" is not offered: a PSD is
 * picked from anywhere on the disk, not from the project.
 */
export function describePsdFailure(
    headline: string,
    code: string | undefined,
    t: (key: TranslationKey, params?: InterpolationParams) => string,
): string {
    const reason = code === PSD_UNREADABLE
        ? ASSET_UNDECODABLE
        : code === FsRejectErrorCode.PERMISSION_DENIED ? code : undefined;
    return withReadFailureReason(headline, reason, t);
}
