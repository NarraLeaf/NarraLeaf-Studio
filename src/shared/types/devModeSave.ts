import type { SaveCompatibilityStamp } from "./saveCompatibility";

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
    user?: unknown;
    /**
     * What produced this save, for deciding whether it may be resumed.
     *
     * In the header rather than inside `savedGame` so a save screen can decide what to offer
     * without opening a single serialized game. Absent on records written before the stamp
     * existed, which is read as "cannot be compared" and loads exactly as it always did - see
     * `@shared/types/saveCompatibility`.
     */
    compatibility?: SaveCompatibilityStamp;
    /**
     * Seconds of play behind this save.
     *
     * In the header rather than inside `savedGame` for the same reason the stamp is: a save screen
     * shows a time against every slot, and reading it out of a serialized game would mean opening
     * one playthrough per slot to look at one number. Absent on records written before playtime was
     * tracked, which a screen reads as "not recorded" rather than as zero.
     */
    playtimeSeconds?: number;
};

export type DevModeSaveRecord = {
    metadata: DevModeSaveMetadata;
    savedGame: unknown;
};

/**
 * One save slot as a listing sees it.
 *
 * The header alone, never the serialized game and never the capture. A save screen opening asks
 * for every slot at once, and the two things it does not need are the two that make a record
 * expensive to read and to send: a whole playthrough and a base64 screenshot.
 */
export type DevModeSaveHeader = {
    id: string;
    createdAt: string;
    updatedAt: string;
    /** Absent on records written before the stamp existed. */
    compatibility?: SaveCompatibilityStamp;
    /** Absent on records written before playtime was tracked. */
    playtimeSeconds?: number;
};

/** The header of a record already in hand. */
export function devModeSaveHeaderOf(record: DevModeSaveRecord): DevModeSaveHeader {
    return {
        id: record.metadata.id,
        createdAt: record.metadata.createdAt,
        updatedAt: record.metadata.updatedAt,
        ...(record.metadata.compatibility ? { compatibility: record.metadata.compatibility } : {}),
        ...(typeof record.metadata.playtimeSeconds === "number"
            ? { playtimeSeconds: record.metadata.playtimeSeconds }
            : {}),
    };
}

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
