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
import { Buffer } from "buffer";
import { Select } from "@/lib/components/elements";

const secondaryGhostButtonClass = "px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-sm text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryGhostIconButtonClass = "inline-flex items-center justify-center p-1.5 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

type CropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type CharacterPropertiesEditorProps = {
    character: Character;
};

export function CharacterPropertiesEditor({ character }: CharacterPropertiesEditorProps) {
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
    const forms = useMemo(() => profile.appearance.getForms(), [profile, formsVersion]);
    const defaultFormOptions = useMemo(
        () => [
            { value: "", label: "Follow first form" },
            ...forms.map(form => ({ value: form.name, label: form.name })),
        ],
        [forms]
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

    const revokeCropperUrl = useCallback(() => {
        if (cropperImageUrl) {
            URL.revokeObjectURL(cropperImageUrl);
        }
    }, [cropperImageUrl]);

    const handleSelectThumbnail = async (assets: Asset[]) => {
        const selected = assets[0];
        if (!selected || !assetsService) {
            setThumbnailError("Workspace not ready");
            return;
        }

        if (selected.type !== AssetType.Image) {
            setThumbnailError("Please select an image asset");
            return;
        }

        const result = await assetsService.fetch<AssetType.Image>(selected as Asset<AssetType.Image>);
        if (!result.success) {
            setThumbnailError(result.error || "Failed to load asset");
            return;
        }

        const buffer = new Uint8Array(result.data.data);
        const blob = new Blob([buffer]);
        const nextUrl = URL.createObjectURL(blob);
        revokeCropperUrl();
        setCropperImageUrl(nextUrl);
        setCroppingAsset(selected);
        setThumbnailError(null);

        const { width, height } = result.data.metadata;
        const side = Math.min(width, height);
        const startX = (width - side) / 2;
        const startY = (height - side) / 2;
        setInitialCrop({
            x: startX,
            y: startY,
            width: side,
            height: side,
        });
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
            setThumbnailError("Workspace not ready");
            return;
        }

        const result = await serviceAssets.deleteFile(currentId);
        if (!result.ok) {
            setThumbnailError(result.error?.message || "Failed to delete thumbnail");
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
        revokeCropperUrl();
        setCropperImageUrl(null);
    }, [revokeCropperUrl]);

    const handleCropConfirm = async (selection: CropRect) => {
        if (!serviceAssets || !croppingAsset || !cropperImageUrl) {
            setThumbnailError("Workspace not ready");
            return;
        }
        setSavingThumbnail(true);
        try {
            const blob = await cropImage(cropperImageUrl, selection);
            const arrayBuffer = await blob.arrayBuffer();
            const writeResult = await serviceAssets.writeFile(Buffer.from(arrayBuffer));
            if (!writeResult.ok) {
                setThumbnailError(writeResult.error?.message || "Failed to save thumbnail");
                return;
            }
            const newId = writeResult.data;
            setThumbnailId(newId);
            profile.setThumbnail(newId);
            resetCropper();
        } catch (error) {
            setThumbnailError(error instanceof Error ? error.message : "Unknown error");
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

    useEffect(() => {
        return () => {
            revokeCropperUrl();
            if (thumbnailUrl) {
                URL.revokeObjectURL(thumbnailUrl);
            }
        };
    }, [revokeCropperUrl, thumbnailUrl]);

    useEffect(() => {
        if (!serviceAssets || !thumbnailId) {
            setThumbnailUrl(null);
            return;
        }

        let cancelled = false;
        let objectUrl: string | null = null;

        const loadThumb = async () => {
            const result = await serviceAssets.readRaw(thumbnailId);
            if (!result.ok || cancelled) {
                setThumbnailUrl(null);
                return;
            }
            objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)]));
            if (!cancelled) {
                setThumbnailUrl(objectUrl);
            }
        };

        void loadThumb();

        return () => {
            cancelled = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [serviceAssets, thumbnailId]);

    return (
        <div className="p-4 space-y-4 text-gray-200">
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Thumbnail
                </label>
                <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-gray-200">Preview</span>
                        <div className="flex items-center gap-2">
                            {thumbnailId && (
                                <button
                                    className="text-xs text-red-400 hover:text-red-300"
                                    onClick={handleClearThumbnail}
                                >
                                    Clear
                                </button>
                            )}
                            <button
                                ref={thumbnailAnchorRef}
                                className={secondaryGhostButtonClass}
                                onClick={() => setSelectorOpen(true)}
                            >
                                Select
                            </button>
                        </div>
                    </div>
                    <div className="relative w-full aspect-square rounded-md border border-white/10 bg-[#0f1115] text-xs text-gray-400 overflow-hidden">
                        {thumbnailUrl ? (
                            <img src={thumbnailUrl} alt="thumbnail" className="absolute inset-0 w-full h-full object-cover" />
                        ) : thumbnailId ? (
                            <div className="absolute inset-0 flex items-center justify-center text-gray-300"></div>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1">
                                <div>No thumbnail yet</div>
                                <div className="text-[11px] text-gray-500">Click Select to choose one</div>
                            </div>
                        )}
                    </div>
                    {thumbnailError && <div className="text-xs text-red-400">{thumbnailError}</div>}
                </div>
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Name
                </label>
                <input
                    className="w-full px-3 py-2 rounded-md bg-[#1e1f22] border border-white/10 text-sm text-gray-300 focus:outline-none focus:border-primary/50 transition-colors"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onBlur={handleNameBlur}
                    placeholder="Character name"
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Description
                </label>
                <textarea
                    className="w-full px-3 py-2 rounded-md bg-[#1e1f22] border border-white/10 text-sm text-gray-300 focus:outline-none focus:border-primary/50 transition-colors resize-none"
                    rows={4}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    placeholder="Character description..."
                />
            </div>

            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Tags
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
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Default Form
                </label>
                <Select
                    fullWidth
                    options={defaultFormOptions}
                    value={defaultForm ?? ""}
                    onChange={handleDefaultFormChange}
                    placeholder="Select default form"
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
                title="Select Thumbnail"
                multiple={false}
            />
            <ImageCropper
                visible={cropperOpen}
                imageUrl={cropperImageUrl || ""}
                initialSelection={initialCrop}
                aspectRatio={1}
                anchorRef={thumbnailAnchorRef}
                title="Crop Thumbnail"
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
                            title="Remove tag"
                            aria-label={`Remove tag ${tag}`}
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </span>
                )) : <span className="text-xs text-gray-500">No tags yet</span>}
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
                    placeholder="Add tag..."
                    className="flex-1 px-3 py-1.5 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 focus:outline-none focus:border-primary/50 transition-colors"
                />
                <button
                    onClick={onAdd}
                    disabled={!newTag.trim()}
                    className={secondaryGhostIconButtonClass}
                    title="Add tag"
                    aria-label="Add tag"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}