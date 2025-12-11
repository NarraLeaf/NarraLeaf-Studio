import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Character } from "@/lib/workspace/services/character/Character";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { X, Plus } from "lucide-react";

const secondaryGhostButtonClass = "px-3 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-sm text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const secondaryGhostIconButtonClass = "inline-flex items-center justify-center p-1.5 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

type CharacterPropertiesEditorProps = {
    character: Character;
};

export function CharacterPropertiesEditor({ character }: CharacterPropertiesEditorProps) {
    const profile = character.profile;
    const snapshot = profile.getProfile();

    const [name, setName] = useState(snapshot.name);
    const [description, setDescription] = useState(snapshot.description);
    const [tags, setTags] = useState<string[]>(snapshot.tags || []);
    const [thumbnailId, setThumbnailId] = useState<string | null>(snapshot.thumbnail);
    const [newTag, setNewTag] = useState("");
    const [selectorOpen, setSelectorOpen] = useState(false);
    const thumbnailAnchorRef = useRef<HTMLDivElement | null>(null);

    const hasTags = useMemo(() => tags.length > 0, [tags]);

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

    const handleSelectThumbnail = (assets: { id: string }[]) => {
        const selected = assets[0];
        const id = selected?.id ?? null;
        setThumbnailId(id);
        profile.setThumbnail(id);
    };

    const handleClearThumbnail = () => {
        setThumbnailId(null);
        profile.setThumbnail(null);
    };

    // Sync local state when character instance changes
    useEffect(() => {
        const next = character.profile.getProfile();
        setName(next.name);
        setDescription(next.description);
        setTags(next.tags || []);
        setThumbnailId(next.thumbnail);
    }, [character]);

    // Keep local state in sync when the current character updates
    useEffect(() => {
        const syncFromProfile = () => {
            const next = character.profile.getProfile();
            setName(next.name);
            setDescription(next.description);
            setTags(next.tags || []);
            setThumbnailId(next.thumbnail);
        };

        const unsubscribe = character.subscribe(syncFromProfile);
        syncFromProfile(); // immediate sync
        return () => unsubscribe();
    }, [character]);

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
                                className={secondaryGhostButtonClass}
                                onClick={() => setSelectorOpen(true)}
                            >
                                Select
                            </button>
                        </div>
                    </div>
                    <div
                        ref={thumbnailAnchorRef}
                        className="h-32 rounded-md border border-white/10 bg-[#0f1115] flex items-center justify-center text-xs text-gray-400 overflow-hidden"
                    >
                        {thumbnailId ? (
                            <div className="text-center space-y-1 px-3">
                                <div className="text-gray-200">Thumbnail selected</div>
                                <div className="text-[11px] break-all text-gray-400">{thumbnailId}</div>
                            </div>
                        ) : (
                            <div className="text-center space-y-1">
                                <div>No thumbnail yet</div>
                                <div className="text-[11px] text-gray-500">Click Select to choose one</div>
                            </div>
                        )}
                    </div>
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

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                selectedIds={thumbnailId ? [thumbnailId] : []}
                onClose={() => setSelectorOpen(false)}
                onConfirm={assets => {
                    handleSelectThumbnail(assets);
                    setSelectorOpen(false);
                }}
                anchorRef={thumbnailAnchorRef}
                title="Select Thumbnail"
                multiple={false}
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