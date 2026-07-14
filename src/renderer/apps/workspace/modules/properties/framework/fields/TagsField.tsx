import { useState, useEffect, useCallback, useRef, memo } from "react";
import { X, Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { TagsFieldDefinition } from "../types";

interface TagsFieldProps<TData> {
    field: TagsFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a tags input field with add/remove functionality
 */
function TagsFieldInner<TData>({ field, data, onSaving }: TagsFieldProps<TData>) {
    const { t } = useTranslation();
    const currentTags = field.getValue(data);
    const [localTags, setLocalTags] = useState<string[]>(currentTags);
    const [newTag, setNewTag] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dataRef = useRef(data);
    dataRef.current = data;

    // Sync when external tags change
    useEffect(() => {
        if (!isSaving) {
            setLocalTags(currentTags);
        }
    }, [currentTags, isSaving]);

    // Refocus input after adding a tag
    useEffect(() => {
        if (newTag === "") {
            const timer = setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [newTag]);

    const handleAddTag = useCallback(async () => {
        const trimmed = newTag.trim();
        if (!trimmed) return;

        // Check for duplicates (case-insensitive)
        const existingLower = localTags.map((t) => t.toLowerCase());
        if (existingLower.includes(trimmed.toLowerCase())) {
            setNewTag("");
            return;
        }

        setIsSaving(true);
        onSaving(true);
        try {
            await field.addTag(dataRef.current, trimmed);
            setLocalTags(field.getValue(dataRef.current));
            setNewTag("");
        } catch (err) {
            console.error(`Failed to add tag ${field.id}:`, err);
        } finally {
            setIsSaving(false);
            onSaving(false);
        }
    }, [field.id, field.addTag, field.getValue, localTags, newTag, onSaving]);

    const handleRemoveTag = useCallback(
        async (tag: string) => {
            setIsSaving(true);
            onSaving(true);
            try {
                await field.removeTag(dataRef.current, tag);
                setLocalTags(field.getValue(dataRef.current));
            } catch (err) {
                console.error(`Failed to remove tag ${field.id}:`, err);
            } finally {
                setIsSaving(false);
                onSaving(false);
            }
        },
        [field.id, field.removeTag, field.getValue, onSaving]
    );

    const isDisabled = field.disabled || isSaving;
    const hasTags = localTags.length > 0;

    return (
        <div className={field.className}>
            {field.label && (
                <label className="block text-xs font-medium text-fg-muted mb-1">
                    {field.label}
                </label>
            )}
            <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                    {hasTags ? (
                        localTags.map((tag) => (
                            <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary text-xs rounded"
                            >
                                {tag}
                                <button
                                    onClick={() => handleRemoveTag(tag)}
                                    disabled={isDisabled}
                                    className="hover:text-primary cursor-default disabled:opacity-50"
                                    title={t("properties.tags.remove")}
                                    aria-label={t("properties.tags.removeAria", { tag })}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))
                    ) : (
                        <span className="text-xs text-fg-subtle">{t("properties.tags.empty")}</span>
                    )}
                </div>
                <div className="flex gap-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddTag();
                            }
                        }}
                        placeholder={field.addPlaceholder ?? t("properties.tags.addPlaceholder")}
                        disabled={isDisabled}
                        className="flex-1 px-3 py-1.5 bg-surface-raised border border-edge rounded-md text-sm text-fg-muted 
                            focus:outline-none focus:border-primary/50 transition-colors
                            disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <button
                        onClick={handleAddTag}
                        disabled={!newTag.trim() || isDisabled}
                        className="px-2 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-md transition-colors 
                            disabled:opacity-50 disabled:cursor-not-allowed cursor-default"
                        title={t("properties.tags.add")}
                        aria-label={t("properties.tags.add")}
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>
            {field.helpText && (
                <p className="mt-1 text-xs text-fg-subtle">{field.helpText}</p>
            )}
        </div>
    );
}

export const TagsField = memo(TagsFieldInner) as typeof TagsFieldInner;
