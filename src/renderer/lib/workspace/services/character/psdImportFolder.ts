import type { RequestStatus } from "@shared/types/ipcEvents";
import { AssetType, categoryOfAssetType, type AssetCategory } from "../assets/assetTypes";
import type { Asset, AssetGroup, AssetSource } from "../assets/types";

/** The slice of the asset library a PSD import files its layer images with. */
export interface PsdImportFolderLibrary {
    getGroupAssetsManager(): { getGroups(category: AssetCategory): AssetGroup[] };
    createGroup(category: AssetCategory, name: string): Promise<RequestStatus<AssetGroup>>;
    moveAssetsToGroup(assets: readonly Asset<AssetType, AssetSource>[], groupId?: string): Promise<RequestStatus<void>>;
}

/**
 * The folder of the image section called `name`: one at the top level first, then one anywhere,
 * so a folder the author has since moved into another is still the one used. Null when there is
 * none.
 */
export function findCharacterImageFolder(groups: readonly AssetGroup[], name: string): AssetGroup | null {
    return groups.find(group => group.name === name && !group.parentGroupId)
        ?? groups.find(group => group.name === name)
        ?? null;
}

/**
 * File a PSD import's layer images in the image folder named after the character - created when
 * missing, reused when it exists - instead of leaving a dozen loose layers in the section's root.
 *
 * A re-import of the same sheet lands its images in the same folder. Answers the folder's id, or the
 * reason nothing was filed; the import itself has already happened either way, so a caller logs a
 * failure rather than undoing the import over a folder.
 */
export async function fileUnderCharacterFolder(
    library: PsdImportFolderLibrary,
    assets: readonly Asset<AssetType, AssetSource>[],
    characterName: string,
): Promise<RequestStatus<string | null>> {
    const name = characterName.trim();
    if (!name || assets.length === 0) {
        return { success: true, data: null };
    }
    const category = categoryOfAssetType(AssetType.Image);
    try {
        let folder = findCharacterImageFolder(library.getGroupAssetsManager().getGroups(category), name);
        if (!folder) {
            const created = await library.createGroup(category, name);
            if (!created.success || !created.data) {
                return { success: false, error: created.success ? "The folder was not created." : created.error };
            }
            folder = created.data;
        }
        const moved = await library.moveAssetsToGroup(assets, folder.id);
        return moved.success ? { success: true, data: folder.id } : { success: false, error: moved.error };
    } catch (thrown: unknown) {
        // Answered rather than thrown: the import this follows has already happened, and a caller
        // that let this escape would report the whole import as failed over a folder.
        return { success: false, error: thrown instanceof Error ? thrown.message : String(thrown) };
    }
}
