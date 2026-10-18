import { getInterface } from "@/lib/app/bridge";
import { AssetExtensions, isBundleAssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetSource } from "@/lib/workspace/services/assets/types";
import { AssetsService, REPLACE_REFUSED_IN_SESSION } from "@/lib/workspace/services/core/AssetsService";
import { describeAssetImportRefusal } from "./importFailure";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, WorkspaceContext } from "@/lib/workspace/services/services";
import type { Translator } from "@shared/i18n";

export type ReplaceAssetContentOutcome = "replaced" | "cancelled" | "failed";

/**
 * "Point this asset at a different file" — pick, swap.
 *
 * Lives outside both call sites because the asset panel's context menu and the properties inspector
 * are the two entry points and they must not drift.
 *
 * The swap is one step on the project's stack ({@link AssetsService.replaceAssetContentUndoably}):
 * Ctrl+Z writes the old file back. So picking the file is the whole decision, and nothing asks again.
 * The asset's current bytes are copied aside before anything is written over them; when that copy
 * cannot be made, nothing is written and the alert says why.
 *
 * Inside a live session there is no such step - the room's undo cannot take a replacement back - and
 * the confirm comes back, with Cancel as the primary button and the keyboard default: the button
 * hierarchy is what says the swap is final there.
 *
 * The file picker is filtered to the asset's own type, and {@link AssetsService.replaceAssetContent}
 * re-checks the magic bytes — an author who renames a zip to `.png` still cannot smuggle it in.
 */
export async function runReplaceAssetContentFlow(
    context: WorkspaceContext,
    asset: Asset,
    t: Translator["t"],
): Promise<ReplaceAssetContentOutcome> {
    const uiService = context.services.get<UIService>(Services.UI);

    if (asset.source !== AssetSource.Local) {
        uiService.showAlert(t("assets.replace.failedTitle"), t("assets.replace.remoteUnsupported"));
        return "failed";
    }

    // A bundle is replaced by another folder, not another file: swapping one file inside a model
    // would leave a tree whose manifest names files from two different exports.
    const selection = isBundleAssetType(asset.type)
        ? await getInterface().fs.selectDirectory(false)
        : await getInterface().fs.selectFile(AssetExtensions[asset.type], false);
    if (!selection.success || !selection.data.ok) {
        return "cancelled";
    }
    const sourcePath = selection.data.data[0];
    if (!sourcePath) {
        return "cancelled";
    }

    const assetsService = context.services.get<AssetsService>(Services.Assets);
    if (assetsService.sharedLive) {
        const confirmed = await uiService.showDestructiveConfirm(
            t("assets.replace.confirmTitle", { name: asset.name }),
            undefined,
            t("assets.replace.confirmAction"),
        );
        if (!confirmed) {
            return "cancelled";
        }
    }

    const result = await assetsService.replaceAssetContentUndoably(asset, sourcePath, {
        key: "assets.history.replaceContent",
        params: { name: asset.name },
    });
    if (!result.success) {
        // Why, in the author's terms: the same refusals an import words. The service's own `error` is
        // English and names both the picked file and the asset's storage path, so it goes to the log -
        // except a live session's refusal, which is written for the author already.
        console.warn("[assets] could not replace the contents", result.error);
        const reason = describeAssetImportRefusal(result.refusal, t)
            ?? (result.code === REPLACE_REFUSED_IN_SESSION ? result.error : undefined)
            ?? t("assets.unknownError");
        uiService.showAlert(t("assets.replace.failedTitle"), reason);
        return "failed";
    }

    return "replaced";
}
