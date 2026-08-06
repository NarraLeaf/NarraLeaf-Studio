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
    ModelAssetMetadata,
    ModelBundleContents,
} from "@/lib/workspace/services/assets/assetTypes";
import { listModelEntryChoices, type ModelBundleFormat } from "@shared/utils/modelBundle";
import {
    PropertyEditorSchema,
    FieldDefinition,
    InfoItem,
    createPropertyEditorSchema,
} from "../framework";
import type { Translator } from "@shared/i18n";
import { AssetReferencesSection } from "../components/AssetReferencesSection";
import { AssetReplaceAction } from "../components/AssetReplaceAction";
import { AssetSourceSection } from "../components/AssetSourceSection";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

/**
 * Context for asset property editors
 * Contains the asset and loaded metadata
 */
export interface AssetEditorContext<T extends AssetType = AssetType> {
    asset: Asset<T>;
    metadata: AssetData<T> | null;
    /**
     * `modelEntry` is the bundle-only arm: the author correcting which file in a model bundle is
     * its entry. It lands in `AssetExtras`, not on the record's own fields, because it is a decision
     * that rides with the asset rather than an observation about it.
     */
    onUpdate: (field: "name" | "tags" | "description" | "modelEntry", value: any) => Promise<void>;
}

/**
 * Common fields shared by all asset editors
 */
function createCommonAssetFields<T extends AssetType>(t: TranslateFn): FieldDefinition<AssetEditorContext<T>>[] {
    return [
        {
            id: "replaceContent",
            type: "custom",
            // Directly under the file readings it invalidates (hash, size, dimensions) and above the
            // author-owned fields, which a replacement leaves alone.
            component: ({ data }) => <AssetReplaceAction asset={data.asset} />,
            order: 50,
        },
        {
            id: "remoteSource",
            type: "custom",
            // Beside `replaceContent` because they are the same kind of thing — "where do this
            // record's bytes come from" — and exactly one of them ever renders: replacing points a
            // local record at another file, refreshing re-takes a remote record's snapshot.
            component: ({ data }) => <AssetSourceSection asset={data.asset} />,
            order: 60,
        },
        {
            id: "name",
            type: "text",
            label: t("common.name"),
            placeholder: t("properties.asset.namePlaceholder"),
            getValue: (ctx) => ctx.asset.name,
            setValue: async (ctx, value) => {
                await ctx.onUpdate("name", value);
            },
            order: 100,
        },
        {
            id: "tags",
            type: "tags",
            label: t("properties.tags.label"),
            addPlaceholder: t("properties.tags.addPlaceholder"),
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
            label: t("common.description"),
            placeholder: t("properties.asset.descriptionPlaceholder"),
            rows: 4,
            getValue: (ctx) => ctx.asset.description,
            setValue: async (ctx, value) => {
                await ctx.onUpdate("description", value);
            },
            order: 300,
        },
        {
            id: "references",
            type: "custom",
            // Last field on every asset type: "what breaks if I delete this?", answered in the
            // panel the user is already in rather than in the delete dialog after the fact.
            component: ({ data }) => <AssetReferencesSection assetId={data.asset.id} />,
            order: 400,
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

function createImageInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.Image>>[] {
    return [
        {
            label: t("properties.asset.info.dimensions"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ImageAssetMetadata | undefined;
                return meta ? `${meta.width} × ${meta.height}` : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.format"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ImageAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ImageAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.hash"),
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const imagePropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.Image>>({
        id: "asset:image",
        title: t("properties.asset.image.title"),
        fields: [
            {
                id: "imageInfo",
                type: "info",
                label: t("properties.asset.image.info"),
                items: createImageInfoItems(t),
                order: 10,
            },
            ...createCommonAssetFields<AssetType.Image>(t),
        ],
        showSavingIndicator: true,
    });

// ==================== Audio Schema ====================

function createAudioInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.Audio>>[] {
    return [
        {
            label: t("properties.asset.info.duration"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? formatDuration(meta.duration) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.sampleRate"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? `${meta.sampleRate} Hz` : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.channels"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? String(meta.channels) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.format"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as AudioAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.hash"),
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const audioPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.Audio>>({
        id: "asset:audio",
        title: t("properties.asset.audio.title"),
        fields: [
            {
                id: "audioInfo",
                type: "info",
                label: t("properties.asset.audio.info"),
                items: createAudioInfoItems(t),
                order: 10,
            },
            ...createCommonAssetFields<AssetType.Audio>(t),
        ],
        showSavingIndicator: true,
    });

// ==================== Video Schema ====================

function createVideoInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.Video>>[] {
    return [
        {
            label: t("properties.asset.info.duration"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta ? formatDuration(meta.duration) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.dimensions"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta ? `${meta.width} × ${meta.height}` : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.frameRate"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta?.frameRate ? `${meta.frameRate} FPS` : "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as VideoAssetMetadata).frameRate,
        },
        {
            label: t("properties.asset.info.format"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as VideoAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.hash"),
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const videoPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.Video>>({
        id: "asset:video",
        title: t("properties.asset.video.title"),
        fields: [
            {
                id: "videoInfo",
                type: "info",
                label: t("properties.asset.video.info"),
                items: createVideoInfoItems(t),
                order: 10,
            },
            ...createCommonAssetFields<AssetType.Video>(t),
        ],
        showSavingIndicator: true,
    });

// ==================== Font Schema ====================

function createFontInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.Font>>[] {
    return [
        {
            label: t("properties.asset.info.family"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.family || "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as FontAssetMetadata).family,
        },
        {
            label: t("properties.asset.info.style"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.style || "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as FontAssetMetadata).style,
        },
        {
            label: t("properties.asset.info.weight"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.weight || "-";
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as FontAssetMetadata).weight,
        },
        {
            label: t("properties.asset.info.format"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta?.format?.toUpperCase() || "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as FontAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.hash"),
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const fontPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.Font>>({
        id: "asset:font",
        title: t("properties.asset.font.title"),
        fields: [
            {
                id: "fontInfo",
                type: "info",
                label: t("properties.asset.font.info"),
                items: createFontInfoItems(t),
                order: 10,
            },
            ...createCommonAssetFields<AssetType.Font>(t),
        ],
        showSavingIndicator: true,
    });

// ==================== JSON Schema ====================

function createJSONInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.JSON>>[] {
    return [
        {
            label: t("properties.asset.info.schema"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as JSONAssetMetadata | undefined;
                return meta?.schema || t("properties.asset.json.noSchema");
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as JSONAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.hash"),
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const jsonPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.JSON>>({
        id: "asset:json",
        title: t("properties.asset.json.title"),
        fields: [
            {
                id: "jsonInfo",
                type: "info",
                label: t("properties.asset.json.info"),
                items: createJSONInfoItems(t),
                order: 10,
            },
            ...createCommonAssetFields<AssetType.JSON>(t),
        ],
        showSavingIndicator: true,
    });

// ==================== Model Schema ====================

/**
 * The bundle inspector. Two jobs: summarise the asset as *one* thing (a file count and a total, not
 * a file list the author has to scroll), and let them correct the entry.
 *
 * The entry override is the only editable field a bundle has, and it exists because detection is a
 * guess from a file listing - Studio deliberately does not parse model formats, so when a folder
 * holds two skeletons, or a format nobody has taught it about, the author is the only one who knows.
 */
function createModelInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.Model>>[] {
    return [
        {
            label: t("properties.asset.model.entry"),
            getValue: (ctx) => {
                const contents = ctx.metadata?.data as ModelBundleContents | undefined;
                if (!contents) return "-";
                if (!contents.entry) {
                    return contents.entryUnresolved === "ambiguous"
                        ? t("properties.asset.model.entryUnresolvedAmbiguous")
                        : t("properties.asset.model.entryUnresolvedNone");
                }
                return <span className="font-mono text-2xs">{contents.entry}</span>;
            },
        },
        {
            label: t("properties.asset.info.format"),
            getValue: (ctx) => {
                const contents = ctx.metadata?.data as ModelBundleContents | undefined;
                return contents ? MODEL_FORMAT_LABELS[contents.format] : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.model.files"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ModelAssetMetadata | undefined;
                return meta ? String(meta.files.length) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as ModelAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
    ];
}

/** Display-only names for the families the entry heuristic recognises. */
const MODEL_FORMAT_LABELS: Record<ModelBundleFormat, string> = {
    "live2d-cubism4": "Live2D Cubism 4",
    "live2d-cubism2": "Live2D Cubism 2",
    "spine-binary": "Spine (binary)",
    "spine-json": "Spine (JSON)",
    "unknown": "-",
};

export const modelPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.Model>>({
        id: "asset:model",
        title: t("properties.asset.model.title"),
        fields: [
            {
                id: "modelInfo",
                type: "info",
                label: t("properties.asset.model.info"),
                items: createModelInfoItems(t),
                order: 10,
            },
            {
                id: "modelEntry",
                type: "select",
                label: t("properties.asset.model.entry"),
                order: 20,
                // Every file is offered, ranked guesses first. Restricting the list to files that
                // *look* like manifests would make the one case this field exists for - a format
                // Studio has never seen - the one case it cannot fix.
                options: (ctx) => {
                    const meta = ctx.metadata?.metadata as ModelAssetMetadata | undefined;
                    return listModelEntryChoices(meta?.files ?? []).map(path => ({ label: path, value: path }));
                },
                getValue: (ctx) => {
                    const contents = ctx.metadata?.data as ModelBundleContents | undefined;
                    return ctx.asset.extras?.modelEntry ?? contents?.entry ?? "";
                },
                setValue: (ctx, value) => ctx.onUpdate("modelEntry", String(value)),
                hidden: (ctx) => !ctx.metadata,
            },
            ...createCommonAssetFields<AssetType.Model>(t),
        ],
        showSavingIndicator: true,
    });

// ==================== Other Schema ====================

function createOtherInfoItems(t: TranslateFn): InfoItem<AssetEditorContext<AssetType.Other>>[] {
    return [
        {
            label: t("properties.asset.info.mimeType"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as OtherAssetMetadata | undefined;
                return meta?.mimeType || t("properties.asset.other.unknown");
            },
            hidden: (ctx) => !ctx.metadata || !(ctx.metadata.metadata as OtherAssetMetadata).mimeType,
        },
        {
            label: t("properties.asset.info.extension"),
            getValue: (ctx) => {
                const parts = ctx.asset.name.split(".");
                return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : t("properties.asset.other.unknown");
            },
        },
        {
            label: t("properties.asset.info.size"),
            getValue: (ctx) => {
                const meta = ctx.metadata?.metadata as OtherAssetMetadata | undefined;
                return meta ? formatSize(meta.size) : "-";
            },
            hidden: (ctx) => !ctx.metadata,
        },
        {
            label: t("properties.asset.info.hash"),
            getValue: (ctx) => (
                <span className="font-mono text-2xs">{ctx.asset.hash.slice(0, 16)}...</span>
            ),
        },
    ];
}

export const otherPropertySchema = (t: TranslateFn) =>
    createPropertyEditorSchema<AssetEditorContext<AssetType.Other>>({
        id: "asset:other",
        title: t("properties.asset.other.title"),
        fields: [
            {
                id: "otherInfo",
                type: "info",
                label: t("properties.asset.other.info"),
                items: createOtherInfoItems(t),
                order: 10,
            },
            ...createCommonAssetFields<AssetType.Other>(t),
        ],
        showSavingIndicator: true,
    });

/**
 * Get the appropriate schema for an asset type. Schemas are built lazily with a
 * translator since their labels are localized (they run outside React).
 */
export function getAssetPropertySchema(
    assetType: AssetType,
    t: TranslateFn
): PropertyEditorSchema<AssetEditorContext<any>> {
    switch (assetType) {
        case AssetType.Image:
            return imagePropertySchema(t);
        case AssetType.Audio:
            return audioPropertySchema(t);
        case AssetType.Video:
            return videoPropertySchema(t);
        case AssetType.Font:
            return fontPropertySchema(t);
        case AssetType.JSON:
            return jsonPropertySchema(t);
        case AssetType.Model:
            return modelPropertySchema(t);
        case AssetType.Other:
        default:
            return otherPropertySchema(t);
    }
}

