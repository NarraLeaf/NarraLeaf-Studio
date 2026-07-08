import { Asset } from "@/lib/workspace/services/assets/types";
import {
    AssetType,
    AssetData,
    ImageAssetMetadata,
    AudioAssetMetadata,
    VideoAssetMetadata,
    FontAssetMetadata,
    JSONAssetMetadata,
    OtherAssetMetadata,
} from "@/lib/workspace/services/assets/assetTypes";
import {
    PropertyEditorSchema,
    FieldDefinition,
    InfoItem,
    createPropertyEditorSchema,
} from "../framework";

/**
 * Context for asset property editors
 * Contains the asset and loaded metadata
 */
export interface AssetEditorContext<T extends AssetType = AssetType> {
    asset: Asset<T>;
    metadata: AssetData<T> | null;
    onUpdate: (field: "name" | "tags" | "description", value: any) => Promise<void>;
}

/**
 * Common fields shared by all asset editors
 */
function createCommonAssetFields<T extends AssetType>(): FieldDefinition<AssetEditorContext<T>>[] {
    return [
        {
            id: "name",
            type: "text",
            label: "Name",
            placeholder: "Asset name",
            getValue: (ctx) => ctx.asset.name,
            setValue: async (ctx, value) => {
                await ctx.onUpdate("name", value);
            },
            order: 100,
        },
        {
            id: "tags",
            type: "tags",
            label: "Tags",
            addPlaceholder: "Add tag...",
            getValue: (ctx) => ctx.asset.tags,
            addTag: async (ctx, tag) => {
                const newTags = [...ctx.asset.tags, tag];
                await ctx.onUpdate("tags", newTags);
            },
            removeTag: async (ctx, tag) => {
                const newTags = ctx.asset.tags.filter((t) => t !== tag);
                await ctx.onUpdate("tags", newTags);
            },
            order: 200,
        },
        {
            id: "description",
            type: "textarea",
            label: "Description",
            placeholder: "Enter description...",
            rows: 4,
            getValue: (ctx) => ctx.asset.description,
            setValue: async (ctx, value) => {
                await ctx.onUpdate("description", value);
            },
            order: 300,
        },
    ];
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration for display
 */
function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

// ==================== Image Schema ====================

function createImageInfoItems(): InfoItem<AssetEditorContext<AssetType.Image>>[] {
    return [
        {
            label: "Dimensions",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ImageAssetMetadata | undefined;
                return meta ? `${meta.width} × ${meta.height}` : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Format",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ImageAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Size",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ImageAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Hash",
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const imagePropertySchema = createPropertyEditorSchema<AssetEditorContext<AssetType.Image>>({
    id: "asset:image",
    title: "Image Properties",
    fields: [
        {
            id: "imageInfo",
            type: "info",
            label: "Image Information",
            items: createImageInfoItems(),
            order: 10,
        },
        ...createCommonAssetFields<AssetType.Image>(),
    ],
    showSavingIndicator: true,
});

// ==================== Audio Schema ====================

function createAudioInfoItems(): InfoItem<AssetEditorContext<AssetType.Audio>>[] {
    return [
        {
            label: "Duration",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? formatDuration(meta.duration) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Sample Rate",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? `${meta.sampleRate} Hz` : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Channels",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? String(meta.channels) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Format",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Size",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Hash",
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const audioPropertySchema = createPropertyEditorSchema<AssetEditorContext<AssetType.Audio>>({
    id: "asset:audio",
    title: "Audio Properties",
    fields: [
        {
            id: "audioInfo",
            type: "info",
            label: "Audio Information",
            items: createAudioInfoItems(),
            order: 10,
        },
        ...createCommonAssetFields<AssetType.Audio>(),
    ],
    showSavingIndicator: true,
});

// ==================== Video Schema ====================

function createVideoInfoItems(): InfoItem<AssetEditorContext<AssetType.Video>>[] {
    return [
        {
            label: "Duration",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta ? formatDuration(meta.duration) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Dimensions",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta ? `${meta.width} × ${meta.height}` : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Frame Rate",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta?.frameRate ? `${meta.frameRate} FPS` : "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as VideoAssetMetadata).frameRate,
        },
        {
            label: "Format",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Size",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Hash",
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const videoPropertySchema = createPropertyEditorSchema<AssetEditorContext<AssetType.Video>>({
    id: "asset:video",
    title: "Video Properties",
    fields: [
        {
            id: "videoInfo",
            type: "info",
            label: "Video Information",
            items: createVideoInfoItems(),
            order: 10,
        },
        ...createCommonAssetFields<AssetType.Video>(),
    ],
    showSavingIndicator: true,
});

// ==================== Font Schema ====================

function createFontInfoItems(): InfoItem<AssetEditorContext<AssetType.Font>>[] {
    return [
        {
            label: "Family",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.family || "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as FontAssetMetadata).family,
        },
        {
            label: "Style",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.style || "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as FontAssetMetadata).style,
        },
        {
            label: "Weight",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.weight || "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as FontAssetMetadata).weight,
        },
        {
            label: "Format",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Size",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Hash",
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const fontPropertySchema = createPropertyEditorSchema<AssetEditorContext<AssetType.Font>>({
    id: "asset:font",
    title: "Font Properties",
    fields: [
        {
            id: "fontInfo",
            type: "info",
            label: "Font Information",
            items: createFontInfoItems(),
            order: 10,
        },
        ...createCommonAssetFields<AssetType.Font>(),
    ],
    showSavingIndicator: true,
});

// ==================== JSON Schema ====================

function createJSONInfoItems(): InfoItem<AssetEditorContext<AssetType.JSON>>[] {
    return [
        {
            label: "Schema",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as JSONAssetMetadata | undefined;
                return meta?.schema || "No schema";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Size",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as JSONAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Hash",
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const jsonPropertySchema = createPropertyEditorSchema<AssetEditorContext<AssetType.JSON>>({
    id: "asset:json",
    title: "JSON Properties",
    fields: [
        {
            id: "jsonInfo",
            type: "info",
            label: "JSON Information",
            items: createJSONInfoItems(),
            order: 10,
        },
        ...createCommonAssetFields<AssetType.JSON>(),
    ],
    showSavingIndicator: true,
});

// ==================== Other Schema ====================

function createOtherInfoItems(): InfoItem<AssetEditorContext<AssetType.Other>>[] {
    return [
        {
            label: "MIME Type",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as OtherAssetMetadata | undefined;
                return meta?.mimeType || "Unknown";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as OtherAssetMetadata).mimeType,
        },
        {
            label: "Extension",
            getValue: (ctx) => {
                const parts = ctx.asset.name.split(".");
                return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "Unknown";
            },
        },
        {
            label: "Size",
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as OtherAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: "Hash",
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const otherPropertySchema = createPropertyEditorSchema<AssetEditorContext<AssetType.Other>>({
    id: "asset:other",
    title: "File Properties",
    fields: [
        {
            id: "otherInfo",
            type: "info",
            label: "File Information",
            items: createOtherInfoItems(),
            order: 10,
        },
        ...createCommonAssetFields<AssetType.Other>(),
    ],
    showSavingIndicator: true,
});

/**
 * Get the appropriate schema for an asset type
 */
export function getAssetPropertySchema(
    assetType: AssetType
): PropertyEditorSchema<AssetEditorContext<any>> {
    switch (assetType) {
        case AssetType.Image:
            return imagePropertySchema;
        case AssetType.Audio:
            return audioPropertySchema;
        case AssetType.Video:
            return videoPropertySchema;
        case AssetType.Font:
            return fontPropertySchema;
        case AssetType.JSON:
            return jsonPropertySchema;
        case AssetType.Other:
        default:
            return otherPropertySchema;
    }
}

