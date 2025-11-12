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
    frameRate?: number;
    size: number;
};

export type JSONAssetMetadata = {
    size: number;
    isValid: boolean;
    schema?: string;
};

export type FontAssetMetadata = {
    family?: string;
    style?: string;
    weight?: string;
    format: string;
    size: number;
};

export type OtherAssetMetadata = {
    mimeType?: string;
    size: number;
};

export type AssetData<Type extends AssetType> = Type extends AssetType.Image ? {
    data: Uint8Array;
    metadata: ImageAssetMetadata;
} : Type extends AssetType.Audio ? {
    data: Uint8Array;
    metadata: AudioAssetMetadata;
} : Type extends AssetType.Video ? {
    data: Uint8Array;
    metadata: VideoAssetMetadata;
} : Type extends AssetType.JSON ? {
    data: Record<string, any>;
    metadata: JSONAssetMetadata;
} : Type extends AssetType.Font ? {
    data: Uint8Array;
    metadata: FontAssetMetadata;
} : Type extends AssetType.Other ? {
    data: Uint8Array;
    metadata: OtherAssetMetadata;
} : never;

export const AssetExtensions = {
    [AssetType.Image]: ["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp"],
    [AssetType.Audio]: ["mp3", "wav", "ogg", "aac", "m4a", "flac", "wma", "aiff", "ape", "alac", "opus", "m4b", "m4p", "m4r", "m4v"],
    [AssetType.Video]: ["mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v", "m4b", "m4p", "m4r", "m4v"],
    [AssetType.JSON]: ["json"],
    [AssetType.Font]: ["ttf", "otf", "woff", "woff2", "eot", "svg"],
    [AssetType.Other]: ["bin", "txt", "log", "csv", "json", "xml", "html", "css", "js", "ts", "jsx", "tsx", "md", "markdown", "yml", "yaml", "toml", "ini", "cfg", "conf", "props", "config", "settings"],
};
