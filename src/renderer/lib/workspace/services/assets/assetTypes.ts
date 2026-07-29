export enum AssetType {
    Image = "image",
    Audio = "audio",
    Video = "video",
    JSON = "json",
    /** Shared blueprint asset (M2); content is {@link import("@shared/types/blueprint/document").SharedBlueprintAsset} JSON */
    Blueprint = "blueprint",
    Font = "font",
    /**
     * A **model bundle**: many files that form one authored thing (a Live2D or Spine character),
     * stored as a directory rather than a single blob.
     *
     * The reason it cannot be flattened into per-file assets: a model's manifest references its
     * siblings by relative path (`Hiyori.2048/texture_00.png`), and the alternative to keeping the
     * tree is rewriting those manifests - which would mean Studio learning to parse every model
     * format there is. So the imported tree is preserved verbatim under the asset id, and the entry
     * file is served from a URL those relative names resolve against.
     */
    Model = "model",
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

export type BlueprintAssetMetadata = {
    size: number;
    isValid: boolean;
    /** Logical schema version of the on-disk JSON wrapper; not the instance BlueprintDocument schema */
    schemaVersion?: number;
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

/**
 * What reading a model bundle reports. Derived from the directory on disk on every read, like every
 * other `*AssetMetadata` here - the only thing persisted in the asset record is the author's entry
 * override (`AssetExtras.modelEntry`), because that is the one value that is a decision rather than
 * an observation.
 */
export type ModelAssetMetadata = {
    /**
     * The entry file, relative to the asset root. e.g. "Hiyori.model3.json"
     *
     * Empty when neither detection nor an author override could name one. A read still succeeds in
     * that state - the bundle's files are on disk and intact, the author just has to say which one
     * is the entry - and it is the inspector's job to show that, not the reader's job to fail.
     */
    entry: string;
    /** Every file in the bundle, relative to the asset root, stable order. */
    files: string[];
    /** Total bytes. */
    size: number;
};

/**
 * The "contents" of a model bundle - a listing, not bytes.
 *
 * Every other asset type hands back the file's bytes here, but a bundle is tens of megabytes across
 * dozens of files and nothing in Studio wants all of it in memory: consumers either show a summary
 * or hand the engine a URL. Bytes are reached through the served entry URL instead.
 */
export type ModelBundleContents = {
    entry: string;
    /** Same list as {@link ModelAssetMetadata.files}. */
    files: string[];
    /** Format guessed from the file tree, for display only. Never parsed from the model itself. */
    format: import("@shared/utils/modelBundle").ModelBundleFormat;
    /**
     * Present when the entry could not be determined from the tree. The record is still valid and
     * its files are intact - the author simply has to say which file is the entry.
     */
    entryUnresolved?: "ambiguous" | "none";
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
} : Type extends AssetType.Blueprint ? {
    data: import("@shared/types/blueprint/document").SharedBlueprintAsset;
    metadata: BlueprintAssetMetadata;
} : Type extends AssetType.Font ? {
    data: Uint8Array;
    metadata: FontAssetMetadata;
} : Type extends AssetType.Model ? {
    data: ModelBundleContents;
    metadata: ModelAssetMetadata;
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
        // Common codecs/containers (Chromium native)
        "mp3", "wav", "wave", "ogg", "oga", "opus", "aac", "m4a", "flac", "weba",
        // Less-common / legacy (may require transcoding)
        "aiff", "aif", "aifc", "mid", "midi", "mp2", "mka",
        // Playlist / container formats
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
    [AssetType.Blueprint]: ["json", "nlbp"],
    [AssetType.Font]: [
        // Font formats loadable in Chromium
        "ttf", "otf", "ttc", // TrueType / OpenType collections
        "woff", "woff2",       // Web optimised font formats
        "eot",                 // Embedded OpenType (legacy IE but harmless)
        "svg", "otc"           // SVG fonts & OpenType collections (rare but supported)
    ],
    /**
     * A model bundle is picked as a *directory*, not by extension, so this list is never handed to a
     * file dialog (the import path branches to `fs.selectDirectory`). It stays `["*"]` because the
     * contents of a bundle are whatever the exporting tool wrote - filtering by extension is exactly
     * the behaviour that would break it.
     */
    [AssetType.Model]: ["*"],
    // Allow any file for the Other type
    [AssetType.Other]: ["*"],
};

/** Whether assets of this type are a directory tree rather than a single file. */
export function isBundleAssetType(type: AssetType): boolean {
    return type === AssetType.Model;
}
