import { AssetType } from "./assetTypes";

export enum AssetSource {
    Local = "local",
    Remote = "remote",
}

export type AssetResolveMeta<Source extends AssetSource> = Source extends AssetSource.Local ? {} : Source extends AssetSource.Remote ? {
    url: string;
} : never;

export interface Asset<Type extends AssetType = AssetType, Source extends AssetSource = AssetSource.Local> {
    type: Type;
    name: string;
    hash: string;
    source: Source;
    meta: AssetResolveMeta<Source>;
}

export type AssetsMap = {
    [K in AssetType]: Record<string, Asset<K>>;
};
