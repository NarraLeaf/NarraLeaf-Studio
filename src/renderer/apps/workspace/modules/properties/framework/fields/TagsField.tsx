import { useState, useEffect, useCallback, useRef, memo } from "react";
import { FieldLabelRow } from "./FieldLabelRow";
import { X, Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { TagsFieldDefinition } from "../types";
import { FIELD_INPUT_CLASS } from "../../fieldControlClass";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";

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

    // Back into the input after an add, so the next tag can be typed straight away. Asked for by the
    // add itself rather than keyed off the emptied input: an empty input is also how the field
    // mounts, and focusing it then pulled the caret into the inspector whenever an author merely
    // selected an asset. Waits for the input to be enabled again (it is disabled while the add is
    // saved), and one request is spent by one focus, so the input being re-enabled later for any
    // other reason does not take the caret.
    const [refocusRequest, setRefocusRequest] = useState(0);
    const refocusPendingRef = useRef(false);
    const requestRefocus = useCallback(() => {
        refocusPendingRef.current = true;
        setRefocusRequest(request => request + 1);
    }, []);
    const isDisabled = field.disabled || isSaving;
    useEffect(() => {
        if (!refocusPendingRef.current || isDisabled) {
            return;
        }
        const timer = setTimeout(() => {
            refocusPendingRef.current = false;
            inputRef.current?.focus();
        }, 10);
        return () => clearTimeout(timer);
    }, [refocusRequest, isDisabled]);

    const handleAddTag = useCallback(async () => {
        const trimmed = newTag.trim();
        if (!trimmed) return;

        // Check for duplicates (case-insensitive)
        const existingLower = localTags.map((t) => t.toLowerCase());
        if (existingLower.includes(trimmed.toLowerCase())) {
            setNewTag("");
            requestRefocus();
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
            requestRefocus();
        }
    }, [field.id, field.addTag, field.getValue, localTags, newTag, onSaving, requestRefocus]);

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

    // The chips are the stored tags as the field says to print them; a tag it does not print gets no
    // chip but stays in the list, so it survives an add and is never what a remove takes out.
    const chips = localTags.flatMap(tag => {
        const label = field.formatTag ? field.formatTag(data, tag) : tag;
        return label === null ? [] : [{ tag, label }];
    });
    const hasTags = chips.length > 0;

    return (
        <div className={field.className}>
            <FieldLabelRow field={field} />
            <div className="space-y-2">
                {/* No tags: no chip row. The "Add tag…" field below is the whole affordance. */}
                {hasTags && (
                    <div className="flex flex-wrap gap-1">
                        {chips.map(({ tag, label }) => (
                            <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary text-xs rounded-md"
                            >
                                {label}
                                <button
                                    onClick={() => handleRemoveTag(tag)}
                                    disabled={isDisabled}
                                    className="hover:text-primary cursor-default disabled:opacity-50"
                                    data-tip={t("properties.tags.remove")}
                                    aria-label={t("properties.tags.removeAria", { tag: label })}
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex gap-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                            if (isImeKeyEvent(e)) {
                                return;
                            }
                            if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddTag();
                            }
                        }}
                        placeholder={field.addPlaceholder ?? t("properties.tags.addPlaceholder")}
                        disabled={isDisabled}
                        className={`flex-1 ${FIELD_INPUT_CLASS}`}
                    />
                    <button
                        onClick={handleAddTag}
                        disabled={!newTag.trim() || isDisabled}
                        className="grid h-9 w-9 place-items-center bg-primary/20 hover:bg-primary/30 text-primary rounded-md transition-colors
                            disabled:opacity-50 disabled:cursor-not-allowed cursor-default"
                        data-tip={t("properties.tags.add")}
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
