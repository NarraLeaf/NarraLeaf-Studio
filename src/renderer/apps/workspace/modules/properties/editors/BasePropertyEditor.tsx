import { useState, useEffect, useCallback, useRef } from "react";
import { X, Plus } from "lucide-react";
import { PropertyEditorProps } from "./PropertyEditorBase";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";

/**
 * Base property editor with common name, tags, and description editing functionality
 * Can be extended by specific asset type editors
 */
export interface BasePropertyEditorProps<T extends AssetType> extends PropertyEditorProps<T> {
    children?: React.ReactNode;
}

export function BasePropertyEditor<T extends AssetType>({ asset, onChange, children }: BasePropertyEditorProps<T>) {
    const { context } = useWorkspace();
    const [name, setName] = useState(asset.name);
    const [tags, setTags] = useState<string[]>(asset.tags);
    const [description, setDescription] = useState(asset.description);
    const [newTag, setNewTag] = useState("");
    const [saving, setSaving] = useState(false);
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
            {/* Additional content (e.g., previews, metadata) */}
            {children}

            {/* Name */}
            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    Name
                </label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleNameBlur}
                    className="w-full px-3 py-2 bg-surface-raised border border-edge rounded-md text-sm text-fg-muted focus:outline-none focus:border-primary/50 transition-colors"
                    disabled={saving}
                />
            </div>

            {/* Tags */}
            <div>
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
                        className="flex-1 px-3 py-1.5 bg-surface-raised border border-edge rounded-md text-sm text-fg-muted focus:outline-none focus:border-primary/50 transition-colors"
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
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    Description
                </label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleDescriptionBlur}
                    rows={4}
                    className="w-full px-3 py-2 bg-surface-raised border border-edge rounded-md text-sm text-fg-muted focus:outline-none focus:border-primary/50 transition-colors resize-none"
                    placeholder="Enter description..."
                    disabled={saving}
                />
            </div>

            {saving && (
                <div className="text-xs text-fg-muted text-center">
                    Saving...
                </div>
            )}
        </div>
    );
}
