
export enum AssetType {
    Image = "image",
    Audio = "audio",
    Video = "video",
    JSON = "json",
    Font = "font",
    Other = "other",
}

export type ImageAssetMetadata = {
    width: number;
    height: number;
    format: string;
    size: number;
};
export type AudioAssetMetadata = {
    duration: number;
    sampleRate: number;
    channels: number;
    format: string;
    size: number;
};
export type VideoAssetMetadata = {
    duration: number;
    width: number;
    height: number;
    format: string;
    size: number;
};

export type AssetData<Type extends AssetType> = Type extends AssetType.Image ? {
    data: Buffer;
    metadata: ImageAssetMetadata;
} : Type extends AssetType.Audio ? {
    data: Buffer;
    metadata: AudioAssetMetadata;
} : Type extends AssetType.Video ? {
    data: Buffer;
    metadata: VideoAssetMetadata;
} : Type extends AssetType.JSON ? {
    data: Record<string, any>;
} : Type extends AssetType.Font ? {
    data: Buffer;
} : Type extends AssetType.Other ? {
    data: Buffer;
} : never;
