export const DEV_MODE_SAVE_TYPE_NORMAL = "save" as const;
export const DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX = "dev-mode-save-preview:" as const;

export type DevModeSaveProjectRef = {
    projectIdentifier?: string;
    projectPath: string;
};

export type DevModeSaveMetadata = {
    id: string;
    type: typeof DEV_MODE_SAVE_TYPE_NORMAL;
    createdAt: string;
    updatedAt: string;
    capture?: string;
};

export type DevModeSaveRecord = {
    metadata: DevModeSaveMetadata;
    savedGame: unknown;
};

export function devModeSavePreviewAssetId(saveId: string): string {
    return `${DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX}${encodeURIComponent(saveId)}`;
}

export function parseDevModeSavePreviewAssetId(assetId: string): string | null {
    if (!assetId.startsWith(DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX)) {
        return null;
    }
    const encoded = assetId.slice(DEV_MODE_SAVE_PREVIEW_ASSET_ID_PREFIX.length);
    try {
        return decodeURIComponent(encoded);
    } catch {
        return null;
    }
}
