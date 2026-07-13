import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Character } from "@/lib/workspace/services/character/Character";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "@/apps/workspace/context";
import { ImageCropper } from "@/apps/workspace/modules/assets/components/ImageCropper";
import { X, Plus } from "lucide-react";
import { Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";

const secondaryGhostButtonClass = "px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-sm text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryGhostIconButtonClass = "inline-flex items-center justify-center p-1.5 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

type CropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type NormalizedCrop = {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
};

// Persist last crop selection in memory for reuse across characters
let lastCropSelection: NormalizedCrop | null = null;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clampDimension = (value: number, max: number) => Math.max(1, Math.min(max, value));

const rememberLastCrop = (selection: CropRect, sourceWidth: number, sourceHeight: number) => {
    if (sourceWidth <= 0 || sourceHeight <= 0) return;
    const widthRatio = clamp01(selection.width / sourceWidth);
    const heightRatio = clamp01(selection.height / sourceHeight);
    const xRatio = clamp01(selection.x / sourceWidth);
    const yRatio = clamp01(selection.y / sourceHeight);
    if (widthRatio === 0 || heightRatio === 0) return;
    lastCropSelection = { xRatio, yRatio, widthRatio, heightRatio };
};

const centeredSquareCrop = (width: number, height: number): CropRect => {
    const side = Math.min(width, height);
    const startX = (width - side) / 2;
    const startY = (height - side) / 2;
    return {
        x: startX,
        y: startY,
        width: side,
        height: side,
    };
};

const getInitialCropForImage = (width: number, height: number): CropRect => {
    if (!lastCropSelection) {
        return centeredSquareCrop(width, height);
    }
    const { xRatio, yRatio, widthRatio, heightRatio } = lastCropSelection;
    const cropWidth = clampDimension(widthRatio * width, width);
    const cropHeight = clampDimension(heightRatio * height, height);
    const maxX = Math.max(0, width - cropWidth);
    const maxY = Math.max(0, height - cropHeight);
    const x = Math.min(maxX, Math.max(0, xRatio * width));
    const y = Math.min(maxY, Math.max(0, yRatio * height));
    return {
        x,
        y,
        width: cropWidth,
        height: cropHeight,
    };
};

type CharacterPropertiesEditorProps = {
    character: Character;
};

export function CharacterPropertiesEditor({ character }: CharacterPropertiesEditorProps) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const profile = character.profile;
    const snapshot = profile.getProfile();

    const [name, setName] = useState(snapshot.name);
    const [description, setDescription] = useState(snapshot.description);
    const [tags, setTags] = useState<string[]>(snapshot.tags || []);
    const [defaultForm, setDefaultForm] = useState<string | null>(snapshot.defaultForm ?? null);
    const [thumbnailId, setThumbnailId] = useState<string | null>(snapshot.thumbnail);
    const [newTag, setNewTag] = useState("");
    const [selectorOpen, setSelectorOpen] = useState(false);
    const [cropperOpen, setCropperOpen] = useState(false);
    const [cropperImageUrl, setCropperImageUrl] = useState<string | null>(null);
    const [initialCrop, setInitialCrop] = useState<CropRect | undefined>(undefined);
    const [croppingAsset, setCroppingAsset] = useState<Asset | null>(null);
    const [thumbnailError, setThumbnailError] = useState<string | null>(null);
    const [savingThumbnail, setSavingThumbnail] = useState(false);
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
    const [cropSourceSize, setCropSourceSize] = useState<{ width: number; height: number } | null>(null);
    const thumbnailAnchorRef = useRef<HTMLButtonElement | null>(null);

    const hasTags = useMemo(() => tags.length > 0, [tags]);

    const assetsService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<AssetsService>(Services.Assets);
    }, [context, isInitialized]);

    const serviceAssets = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<ServiceAssetsService>(Services.ServiceAssets);
    }, [context, isInitialized]);

    const [formsVersion, setFormsVersion] = useState(0);
    const forms = useMemo(() => [...profile.appearance.getForms()], [profile, formsVersion]);
    useEffect(() => {
        const appearance = profile.appearance;
        if (!appearance) return;
        const handleAppearanceChange = () => setFormsVersion(v => v + 1);
        const unsubscribe = appearance.subscribe(handleAppearanceChange);
        return () => unsubscribe();
    }, [profile]);
    const defaultFormOptions = useMemo(
        () => [
            { value: "", label: t("characters.properties.followFirstForm") },
            ...forms.map(form => ({ value: form.name, label: form.name })),
        ],
        [forms, formsVersion, t]
    );

    const normalizeTag = useCallback((tag: string) => tag.trim().toLowerCase(), []);

    const handleNameBlur = () => {
        if (name !== snapshot.name) {
            profile.setName(name);
        }
    };

    const handleDescriptionBlur = () => {
        if (description !== snapshot.description) {
            profile.setDescription(description);
        }
    };

    const handleAddTag = () => {
        const raw = newTag.trim();
        if (!raw) return;

        // Avoid duplicates (case-insensitive, trimmed)
        const existing = new Set((profile.getProfile().tags || []).map(normalizeTag));
        if (existing.has(normalizeTag(raw))) {
            setNewTag("");
            return;
        }

        profile.addTag(raw);
        const latest = profile.getProfile().tags || [];
        setTags([...latest]);
        setNewTag("");
    };

    const handleRemoveTag = (tag: string) => {
        profile.removeTag(tag);
        const latest = profile.getProfile().tags || [];
        setTags([...latest]);
    };

    const handleDefaultFormChange = (value: string | number) => {
        const next = value === "" ? null : String(value);
        setDefaultForm(next);
        profile.setDefaultForm(next);
    };

    const handleSelectThumbnail = async (assets: Asset[]) => {
        const selected = assets[0];
        if (!selected || !assetsService) {
            setThumbnailError(t("characters.properties.error.workspaceNotReady"));
            return;
        }

        if (selected.type !== AssetType.Image) {
            setThumbnailError(t("characters.properties.error.selectImageAsset"));
            return;
        }

        const result = await assetsService.fetch<AssetType.Image>(selected as Asset<AssetType.Image>);
        if (!result.success) {
            setThumbnailError(result.error || t("characters.errors.assetLoad"));
            return;
        }

        const buffer = new Uint8Array(result.data.data);
        const blob = new Blob([buffer]);
        const nextUrl = URL.createObjectURL(blob);
        // Note: old cropperImageUrl will be cleaned up by the effect
        setCropperImageUrl(nextUrl);
        setCroppingAsset(selected);
        setThumbnailError(null);

        const { width, height } = result.data.metadata;
        const side = Math.min(width, height);
        const startX = (width - side) / 2;
        const startY = (height - side) / 2;
        const initial = getInitialCropForImage(width, height);
        setInitialCrop(initial ?? { x: startX, y: startY, width: side, height: side });
        setCropSourceSize({ width, height });
        setCropperOpen(true);
    };

    const handleClearThumbnail = async () => {
        const currentId = thumbnailId;
        if (!currentId) {
            setThumbnailId(null);
            profile.setThumbnail(null);
            return;
        }

        // Optimistically clear UI
        setThumbnailId(null);
        profile.setThumbnail(null);
        if (thumbnailUrl) {
            URL.revokeObjectURL(thumbnailUrl);
            setThumbnailUrl(null);
        }

        if (!serviceAssets) {
            setThumbnailError(t("characters.properties.error.workspaceNotReady"));
            return;
        }

        const result = await serviceAssets.deleteFile(currentId);
        if (!result.ok) {
            setThumbnailError(result.error?.message || t("characters.properties.error.deleteThumbnailFailed"));
        }
    };

    const cropImage = async (imageUrl: string, selection: CropRect): Promise<Blob> => {
        const { x, y, width, height } = selection;
        const loadImage = () =>
            new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error("Failed to load image for cropping"));
                img.src = imageUrl;
            });

        const img = await loadImage();
        const canvas = document.createElement("canvas");
        const targetWidth = Math.max(1, Math.round(width));
        const targetHeight = Math.max(1, Math.round(height));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Canvas context unavailable");
        }
        ctx.drawImage(img, x, y, width, height, 0, 0, targetWidth, targetHeight);

        const toBlob = () =>
            new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error("Failed to generate thumbnail"));
                    }
                }, "image/png");
            });

        return toBlob();
    };

    const resetCropper = useCallback(() => {
        setCropperOpen(false);
        setCroppingAsset(null);
        setInitialCrop(undefined);
        setCropSourceSize(null);
        // Note: cropperImageUrl cleanup is handled by the effect
        setCropperImageUrl(null);
    }, []);

    const handleCropConfirm = async (selection: CropRect) => {
        if (!serviceAssets || !croppingAsset || !cropperImageUrl) {
            setThumbnailError(t("characters.properties.error.workspaceNotReady"));
            return;
        }
        setSavingThumbnail(true);
        try {
            if (cropSourceSize) {
                rememberLastCrop(selection, cropSourceSize.width, cropSourceSize.height);
            }
            const blob = await cropImage(cropperImageUrl, selection);
            const arrayBuffer = await blob.arrayBuffer();
            const writeResult = await serviceAssets.writeFile(new Uint8Array(arrayBuffer));
            if (!writeResult.ok) {
                setThumbnailError(writeResult.error?.message || t("characters.properties.error.saveThumbnailFailed"));
                return;
            }
            const newId = writeResult.data;
            setThumbnailId(newId);
            profile.setThumbnail(newId);
            resetCropper();
        } catch (error) {
            setThumbnailError(error instanceof Error ? error.message : t("characters.properties.error.unknown"));
        } finally {
            setSavingThumbnail(false);
        }
    };

    // Sync local state when character instance changes
    useEffect(() => {
        const next = character.profile.getProfile();
        setName(next.name);
        setDescription(next.description);
        setTags(next.tags || []);
        setDefaultForm(next.defaultForm ?? null);
        setThumbnailId(next.thumbnail);
        setFormsVersion(v => v + 1);
    }, [character]);

    // Keep local state in sync when the current character updates
    useEffect(() => {
        const syncFromProfile = () => {
            const next = character.profile.getProfile();
            setName(next.name);
            setDescription(next.description);
            setTags(next.tags || []);
            setDefaultForm(next.defaultForm ?? null);
            setThumbnailId(next.thumbnail);
            setFormsVersion(v => v + 1);
        };

        const unsubscribe = character.subscribe(syncFromProfile);
        syncFromProfile(); // immediate sync
        return () => unsubscribe();
    }, [character]);

    // Track the current thumbnail object URL and its associated thumbnailId
    const thumbnailUrlStateRef = useRef<{ url: string; thumbnailId: string } | null>(null);

    // Cleanup cropper URL when it changes
    useEffect(() => {
        // Store the current URL so cleanup uses the correct value
        const urlToRevoke = cropperImageUrl;
        return () => {
            if (urlToRevoke) {
                URL.revokeObjectURL(urlToRevoke);
            }
        };
    }, [cropperImageUrl]);

    // Cleanup thumbnail URL on unmount only
    useEffect(() => {
        return () => {
            if (thumbnailUrlStateRef.current) {
                URL.revokeObjectURL(thumbnailUrlStateRef.current.url);
                thumbnailUrlStateRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        // If no thumbnailId, clear everything
        if (!thumbnailId) {
            if (thumbnailUrlStateRef.current) {
                URL.revokeObjectURL(thumbnailUrlStateRef.current.url);
                thumbnailUrlStateRef.current = null;
            }
            setThumbnailUrl(null);
            return;
        }

        // If URL already exists for this thumbnailId, no need to reload
        if (thumbnailUrlStateRef.current?.thumbnailId === thumbnailId) {
            // Ensure state is in sync
            setThumbnailUrl(thumbnailUrlStateRef.current.url);
            return;
        }

        // Wait for services to be ready
        if (!serviceAssets) {
            return;
        }

        let cancelled = false;

        const loadThumb = async () => {
            const result = await serviceAssets.readRaw(thumbnailId);
            if (!result.ok || cancelled) {
                if (!cancelled) setThumbnailUrl(null);
                return;
            }
            // Clean up previous URL before creating new one
            if (thumbnailUrlStateRef.current) {
                URL.revokeObjectURL(thumbnailUrlStateRef.current.url);
            }
            const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)]));
            if (!cancelled) {
                thumbnailUrlStateRef.current = { url: objectUrl, thumbnailId };
                setThumbnailUrl(objectUrl);
            } else {
                // If cancelled after creation, clean up immediately
                URL.revokeObjectURL(objectUrl);
            }
        };

        void loadThumb();

        return () => {
            cancelled = true;
        };
    }, [serviceAssets, thumbnailId]);

    return (
        <div className="p-4 space-y-4 text-fg">
            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {t("characters.properties.thumbnail")}
                </label>
                <div className="bg-surface-raised border border-edge rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-fg">{t("characters.properties.preview")}</span>
                        <div className="flex items-center gap-2">
                            {thumbnailId && (
                                <button
                                    className="text-xs text-red-400 hover:text-red-300"
                                    onClick={handleClearThumbnail}
                                >
                                    {t("common.clear")}
                                </button>
                            )}
                            <button
                                ref={thumbnailAnchorRef}
                                className={secondaryGhostButtonClass}
                                onClick={() => setSelectorOpen(true)}
                            >
                                {t("characters.properties.select")}
                            </button>
                        </div>
                    </div>
                    <div className="relative w-full aspect-square rounded-md border border-edge bg-surface text-xs text-fg-muted overflow-hidden">
                        {thumbnailUrl ? (
                            <img src={thumbnailUrl} alt={t("characters.properties.thumbnailAlt")} className="absolute inset-0 w-full h-full object-cover" />
                        ) : thumbnailId ? (
                            <div className="absolute inset-0 flex items-center justify-center text-fg-muted"></div>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1">
                                <div>{t("characters.properties.noThumbnail")}</div>
                                <div className="text-2xs text-fg-subtle">{t("characters.properties.selectHint")}</div>
                            </div>
                        )}
                    </div>
                    {thumbnailError && <div className="text-xs text-red-400">{thumbnailError}</div>}
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {t("common.name")}
                </label>
                <input
                    className="w-full px-3 py-2 rounded-md bg-surface-raised border border-edge text-sm text-fg-muted focus:outline-none focus:border-primary/50 transition-colors"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onBlur={handleNameBlur}
                    placeholder={t("characters.properties.namePlaceholder")}
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {t("common.description")}
                </label>
                <textarea
                    className="w-full px-3 py-2 rounded-md bg-surface-raised border border-edge text-sm text-fg-muted focus:outline-none focus:border-primary/50 transition-colors resize-none"
                    rows={4}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    placeholder={t("characters.properties.descriptionPlaceholder")}
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {t("characters.properties.tags")}
                </label>
                <TagEditor
                    tags={tags}
                    hasTags={hasTags}
                    newTag={newTag}
                    onChangeNewTag={setNewTag}
                    onAdd={handleAddTag}
                    onRemove={handleRemoveTag}
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {t("characters.properties.defaultForm")}
                </label>
                <Select
                    fullWidth
                    options={defaultFormOptions}
                    value={defaultForm ?? ""}
                    onChange={handleDefaultFormChange}
                    placeholder={t("characters.properties.selectDefaultForm")}
                />
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                selectedIds={thumbnailId ? [thumbnailId] : []}
                onClose={() => setSelectorOpen(false)}
                onConfirm={assets => {
                    setSelectorOpen(false);
                    void handleSelectThumbnail(assets);
                }}
                anchorRef={thumbnailAnchorRef}
                title={t("characters.properties.selectThumbnailTitle")}
                multiple={false}
            />
            <ImageCropper
                visible={cropperOpen}
                imageUrl={cropperImageUrl || ""}
                initialSelection={initialCrop}
                aspectRatio={1}
                anchorRef={thumbnailAnchorRef}
                title={t("characters.properties.cropThumbnailTitle")}
                onClose={resetCropper}
                onConfirm={handleCropConfirm}
                className={savingThumbnail ? "pointer-events-none opacity-90" : ""}
            />
        </div>
    );
}

type TagEditorProps = {
    tags: string[];
    hasTags: boolean;
    newTag: string;
    onChangeNewTag: (value: string) => void;
    onAdd: () => void;
    onRemove: (tag: string) => void;
};

function TagEditor({ tags, hasTags, newTag, onChangeNewTag, onAdd, onRemove }: TagEditorProps) {
    const { t } = useTranslation();
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
                {hasTags ? tags.map(tag => (
                    <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary text-xs rounded"
                    >
                        {tag}
                        <button
                            onClick={() => onRemove(tag)}
                            className="hover:text-primary"
                            title={t("characters.properties.removeTag")}
                            aria-label={t("characters.properties.removeTagAria", { tag })}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                )) : <span className="text-xs text-fg-subtle">{t("characters.properties.noTags")}</span>}
            </div>
            <div className="flex gap-1">
                <input
                    type="text"
                    value={newTag}
                    onChange={(e) => onChangeNewTag(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onAdd();
                        }
                    }}
                    placeholder={t("characters.properties.addTagPlaceholder")}
                    className="flex-1 px-3 py-1.5 bg-surface-raised border border-edge rounded-md text-sm text-fg-muted focus:outline-none focus:border-primary/50 transition-colors"
                />
                <button
                    onClick={onAdd}
                    disabled={!newTag.trim()}
                    className={secondaryGhostIconButtonClass}
                    title={t("characters.properties.addTag")}
                    aria-label={t("characters.properties.addTag")}
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}