import { AssetType } from "./assetTypes";

export enum AssetSource {
    Local = "local",
    Remote = "remote",
}

export type AssetResolveMeta<Source extends AssetSource> = Source extends AssetSource.Local ? {} : Source extends AssetSource.Remote ? {
    url: string;
} : never;

/**
 * Asset interface with user metadata
 * Stored in assets metadata files
 */
export interface Asset<Type extends AssetType = AssetType, Source extends AssetSource = AssetSource.Local> {
    type: Type;
    name: string;
    hash: string;
    source: Source;
    meta: AssetResolveMeta<Source>;
    tags: string[];
    description: string;
    groupId?: string;
}

export type AssetsMap = {
    [K in AssetType]: Record<string, Asset<K>>;
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
