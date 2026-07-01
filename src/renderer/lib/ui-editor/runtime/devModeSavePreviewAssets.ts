import {
    devModeSavePreviewAssetId,
    parseDevModeSavePreviewAssetId,
} from "@shared/types/devModeSave";

const previewUrls = new Map<string, string>();

export function registerDevModeSavePreviewImage(saveId: string, url: string): string {
    const assetId = devModeSavePreviewAssetId(saveId);
    previewUrls.set(assetId, url);
    return assetId;
}

export function resolveDevModeSavePreviewImageUrl(assetId: string): string | null {
    if (parseDevModeSavePreviewAssetId(assetId) === null) {
        return null;
    }
    return previewUrls.get(assetId) ?? null;
}

export function clearDevModeSavePreviewImages(): void {
    previewUrls.clear();
}
