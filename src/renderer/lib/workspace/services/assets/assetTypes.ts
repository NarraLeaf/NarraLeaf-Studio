
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

export const AssetExtensions = {
    [AssetType.Image]: ["png", "jpg", "jpeg", "gif", "bmp", "tiff", "webp"],
    [AssetType.Audio]: ["mp3", "wav", "ogg", "aac", "m4a", "flac", "wma", "aiff", "ape", "alac", "opus", "m4b", "m4p", "m4r", "m4v"],
    [AssetType.Video]: ["mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v", "m4b", "m4p", "m4r", "m4v"],
    [AssetType.JSON]: ["json"],
    [AssetType.Font]: ["ttf", "otf", "woff", "woff2", "eot", "svg"],
    [AssetType.Other]: ["bin", "txt", "log", "csv", "json", "xml", "html", "css", "js", "ts", "jsx", "tsx", "md", "markdown", "yml", "yaml", "toml", "ini", "cfg", "conf", "props", "config", "settings"],
};
