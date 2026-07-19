import { AssetType } from "./assetTypes";

export enum AssetSource {
    Local = "local",
    Remote = "remote",
}

export type AssetResolveMeta<Source extends AssetSource> = Source extends AssetSource.Local ? {} : Source extends AssetSource.Remote ? {
    url: string;
    /**
     * The cache lifetime of the asset in milliseconds  
     * This will only affect the asset fetching in production.
     */
    lifetime: number;
    protocol: string;
    hostname: string;
    path: string;
    query: string;
    hash: string;
    search: string;
    searchParams: Record<string, string>;
} : never;

/**
 * Asset interface with user metadata
 * Stored in assets metadata files
 */
export interface Asset<Type extends AssetType = AssetType, Source extends AssetSource = AssetSource> {
    id: string; // Unique identifier (UUID) used for indexing and file storage
    type: Type;
    name: string;
    hash: string; // File hash (read-only)
    ext?: string;
    source: Source;
    meta: AssetResolveMeta<Source>;
    tags: string[];
    description: string;
    groupId?: string;
    /**
     * Editor-authored data that rides with the asset record. Persisted in the assets metadata,
     * which is a project file under version control - so this is for things the *author* decided
     * (and would want to keep and share), never for derived caches. Anything recomputable belongs
     * under {@link ProjectNameConvention.EditorThumbnailCache}'s neighbours in `editor/cache/`.
     */
    extras?: AssetExtras;
}

/** A marker the author placed on an audio asset - e.g. a BGM's loop in/out points. */
export interface AssetCuePoint {
    /** Offset from the start of the clip, in milliseconds. */
    timeMs: number;
    label?: string;
}

export interface AssetExtras {
    /** Audio only: cue points shown and edited by the audio preview. */
    cuePoints?: AssetCuePoint[];
}

export type AssetsMap = {
    [K in AssetType]: Record<string, Asset<K, AssetSource>>;
};

/**
 * Asset group for organizing assets
 */
export interface AssetGroup {
    id: string;
    name: string;
    type: AssetType;
    parentGroupId?: string;
    createdAt: number;
    updatedAt: number;
}

/**
 * Group map organized by asset type
 */
export type AssetGroupMap = {
    [K in AssetType]: Record<string, AssetGroup>;
};
