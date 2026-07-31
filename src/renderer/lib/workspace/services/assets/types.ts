import type { AudioClipRegion } from "@shared/types/audio";
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

/**
 * The points the author marked on an audio asset - where a BGM starts, where it ends, and where
 * each repeat returns to.
 *
 * One region per asset, not a list of markers: a clip has exactly one region worth naming, and the
 * thing downstream wants to ask is "where does this loop", which a bag of markers cannot answer.
 * Any marker may stand alone while the author is still deciding.
 *
 * The same shape the game bundle carries ({@link AudioClipRegion}) - deliberately one type, because
 * the region an author marks here is the region the engine plays. `@shared/types/audio` owns the
 * normalizer both sides read it with.
 */
export type AssetAudioLoop = AudioClipRegion;

export interface AssetExtras {
    /** Audio only: the loop region shown and edited by the audio preview. */
    audioLoop?: AssetAudioLoop;
    /**
     * Model bundles only: the entry file the author chose, relative to the bundle root.
     *
     * The only part of a bundle that is persisted rather than re-read from disk, because it is the
     * only part that is a *decision*. `files` and `size` are observations and are recomputed on
     * every read; the entry is a guess Studio made from the file tree that the author may have
     * corrected, and a guess that silently re-runs would undo the correction.
     *
     * Absent means "use the detected entry" - so a bundle whose detection is unambiguous carries no
     * extra state at all, and re-detection keeps working if a later Studio learns a new format.
     */
    modelEntry?: string;
    /**
     * Superseded by {@link audioLoop}, which replaced a free list of markers with the one in/out
     * pair a clip actually has. Read only so records written by the short-lived cue-point model
     * still open with their points intact - the editor rewrites them as `audioLoop` on the next
     * edit and clears this. Never write it.
     *
     * @deprecated
     */
    cuePoints?: { timeMs: number }[];
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
