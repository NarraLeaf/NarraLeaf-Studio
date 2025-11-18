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
    // Comprehensive extension lists supported by Chromium (Chrome) for each media type
    [AssetType.Image]: [
        // Raster images
        "png", "apng", "avif", "jpg", "jpeg", "jfif", "pjpeg", "pjp", "bmp", "dib", "gif", "webp", "tif", "tiff", "ico", "cur", "xbm",
        // Vector images
        "svg"
    ],
    [AssetType.Audio]: [
        // Common codecs/containers
        "mp3", "wav", "wave", "ogg", "oga", "opus", "aac", "m4a", "flac", "wma", "weba",
        // Less-common / legacy but recognised
        "aiff", "aif", "aifc", "ape", "alac", "mid", "midi", "caf", "amr", "mp2", "mka",
        // Playlist / container formats people may import as audio assets
        "m3u", "m3u8", "pls"
    ],
    [AssetType.Video]: [
        // Modern web formats
        "mp4", "m4v", "m4p", "m4b", "m4r", "mov", "qt", "webm", "mkv", "av1",
        // Legacy / additional container formats Chromium can demux with the correct codecs installed
        "3gp", "3g2", "avi", "flv", "f4v", "wmv", "asf", "mpg", "mpeg", "mpe", "mpv", "m2v", "ts", "m2ts", "mts", "m2t", "ogv", "ogm", "ogx", "vob"
    ],
    [AssetType.JSON]: [
        // Standard JSON and JSON with comments (supported by many editors)
        "json", "jsonc"
    ],
    [AssetType.Font]: [
        // Font formats loadable in Chromium
        "ttf", "otf", "ttc", // TrueType / OpenType collections
        "woff", "woff2",       // Web optimised font formats
        "eot",                 // Embedded OpenType (legacy IE but harmless)
        "svg", "otc"           // SVG fonts & OpenType collections (rare but supported)
    ],
    // Allow any file for the Other type
    [AssetType.Other]: ["*"],
};
