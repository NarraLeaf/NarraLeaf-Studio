import { useState, useEffect, useCallback, useRef } from "react";
import { X, Plus, Image as ImageIcon } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { AssetType, AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Image property editor
 * Allows editing name, tags, and description for image assets
 */
export function ImagePropertyEditor({ asset, onChange }: PropertyEditorProps<AssetType.Image>) {
    const { context } = useWorkspace();
    const [name, setName] = useState(asset.name);
    const [tags, setTags] = useState<string[]>(asset.tags);
    const [description, setDescription] = useState(asset.description);
    const [newTag, setNewTag] = useState("");
    const [saving, setSaving] = useState(false);
    const [imageData, setImageData] = useState<AssetData<AssetType.Image> | null>(null);
    const tagInputRef = useRef<HTMLInputElement>(null);

    // Sync local state when asset reference changes
    useEffect(() => {
        setName(asset.name);
        setTags(asset.tags);
        setDescription(asset.description);
    }, [asset]);

    // Keep focus on tag input after adding a tag
    useEffect(() => {
        if (newTag === "") {
            // Small delay to ensure DOM has updated
            const timer = setTimeout(() => {
                tagInputRef.current?.focus();
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [newTag]);

    // Load image metadata
    useEffect(() => {
        if (!context) return;

        const loadMetadata = async () => {
            try {
                const assetsService = context.services.get<AssetsService>(Services.Assets);
                const result = await assetsService.fetch(asset);

                if (result.success) {
                    setImageData(result.data);
                }
            } catch (err) {
                console.error("Failed to load image metadata:", err);
            }
        };

        loadMetadata();
    }, [context, asset]);

    // Debounced save
    const saveChanges = useCallback(async (field: 'name' | 'tags' | 'description', value: any) => {
        if (!context) return;

        setSaving(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);

            switch (field) {
                case 'name':
                    await assetsService.renameAsset(asset, value);
                    break;
                case 'tags':
                    await assetsService.updateAssetTags(asset, value);
                    break;
                case 'description':
                    await assetsService.updateAssetDescription(asset, value);
                    break;
            }

            onChange?.({ ...asset, [field]: value });
        } catch (err) {
            console.error(`Failed to update ${field}:`, err);
        } finally {
            setSaving(false);
        }
    }, [context, asset, onChange]);

    const handleNameBlur = () => {
        if (name !== asset.name) {
            saveChanges('name', name);
        }
    };

    const handleAddTag = () => {
        if (newTag.trim() && !tags.includes(newTag.trim())) {
            const newTags = [...tags, newTag.trim()];
            setTags(newTags);
            setNewTag("");
            saveChanges('tags', newTags);
        }
    };

    const handleRemoveTag = (tag: string) => {
        const newTags = tags.filter(t => t !== tag);
        setTags(newTags);
        saveChanges('tags', newTags);
    };

    const handleDescriptionBlur = () => {
        if (description !== asset.description) {
            saveChanges('description', description);
        }
    };

    return (
        <div className="p-4 space-y-4">
            {/* Preview */}
            {imageData && (
                <div className="bg-[#1e1f22] rounded-md p-3 border border-white/10">
                    <div className="flex items-center gap-2 mb-2">
                        <ImageIcon className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-300">Preview</span>
                    </div>
                    <div className="flex items-center justify-center bg-[#0f1115] rounded p-2">
                        <div className="text-xs text-gray-500 text-center">
                            {imageData.metadata.width} × {imageData.metadata.height}
                            <br />
                            {imageData.metadata.format.toUpperCase()}
                            <br />
                            {(imageData.metadata.size / 1024).toFixed(1)} KB
                        </div>
                    </div>
                </div>
            )}

            {/* Name */}
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleNameBlur}
                    className="w-full px-3 py-2 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 focus:outline-none focus:border-primary/50 transition-colors"
                    disabled={saving}
                />
            </div>

            {/* Tags */}
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Tags
                </label>
                <div className="flex flex-wrap gap-1 mb-2">
                    {tags.map((tag) => (
                        <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary text-xs rounded"
                        >
                            {tag}
                            <button
                                onClick={() => handleRemoveTag(tag)}
                                className="hover:text-primary cursor-default"
                                disabled={saving}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-1">
                    <input
                        ref={tagInputRef}
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddTag();
                            }
                        }}
                        placeholder="Add tag..."
                        className="flex-1 px-3 py-1.5 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 focus:outline-none focus:border-primary/50 transition-colors"
                        disabled={saving}
                    />
                    <button
                        onClick={handleAddTag}
                        disabled={!newTag.trim() || saving}
                        className="px-2 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-default"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Description */}
            <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    Description
                </label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    rows={4}
                    className="w-full px-3 py-2 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 focus:outline-none focus:border-primary/50 transition-colors resize-none"
                    placeholder="Enter description..."
                    disabled={saving}
                />
            </div>

            {/* Technical Info (Read-only) */}
            {imageData && (
                <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        Image Information
                    </label>
                    <div className="bg-[#1e1f22] border border-white/10 rounded-md p-3 space-y-1">
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Dimensions:</span>
                            <span className="text-gray-300">
                                {imageData.metadata.width} × {imageData.metadata.height}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Format:</span>
                            <span className="text-gray-300">{imageData.metadata.format.toUpperCase()}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-gray-300">{(imageData.metadata.size / 1024).toFixed(1)} KB</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-gray-400">Hash:</span>
                            <span className="text-gray-300 font-mono text-[10px]">{asset.hash.slice(0, 16)}...</span>
                        </div>
                    </div>
                </div>
            )}

            {saving && (
                <div className="text-xs text-gray-400 text-center">
                    Saving...
                </div>
            )}
        </div>
    );
}

