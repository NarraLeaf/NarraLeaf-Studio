import { useState, useCallback, useMemo, memo, useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import { PropertyEditorSchema, FieldDefinition, PropertyEditorTab } from "./types";
import { FieldRenderer } from "./fields";

interface PropertyEditorProps<TData> {
    /** The schema defining the editor fields */
    schema: PropertyEditorSchema<TData>;
    /** The data being edited */
    data: TData;
    /** Called when data changes */
    onChange?: (data: TData) => void;
    /** Additional class name */
    className?: string;
}

/**
 * Generic property editor component that renders fields based on schema
 */
const FIELD_ORDER_MAX = Number.MAX_SAFE_INTEGER;

function sortFields<TData>(fields: FieldDefinition<TData>[]): FieldDefinition<TData>[] {
    return [...fields].sort((a, b) => {
        const orderA = a.order ?? FIELD_ORDER_MAX;
        const orderB = b.order ?? FIELD_ORDER_MAX;
        return orderA - orderB;
    });
}

function sortTabs<TData>(tabs: PropertyEditorTab<TData>[]): PropertyEditorTab<TData>[] {
    return [...tabs].sort((a, b) => {
        const orderA = a.order ?? FIELD_ORDER_MAX;
        const orderB = b.order ?? FIELD_ORDER_MAX;
        return orderA - orderB;
    });
}

function PropertyEditorInner<TData>({
    schema,
    data,
    onChange,
    className = "",
}: PropertyEditorProps<TData>) {
    const { t } = useTranslation();
    const [savingCount, setSavingCount] = useState(0);
    const [activeTabId, setActiveTabId] = useState<string | null>(
        () => schema.defaultTabId ?? schema.tabs?.[0]?.id ?? null
    );

    const sortedTabs = useMemo<PropertyEditorTab<TData>[]>(() => {
        if (!schema.tabs?.length) {
            return [];
        }
        return sortTabs(schema.tabs);
    }, [schema.id, schema.tabs]);

    const defaultTabId = useMemo(() => {
        if (sortedTabs.length === 0) {
            return null;
        }
        if (schema.defaultTabId) {
            const preferred = sortedTabs.find(tab => tab.id === schema.defaultTabId);
            if (preferred) {
                return preferred.id;
            }
        }
        return sortedTabs[0].id;
    }, [schema.defaultTabId, sortedTabs]);

    useEffect(() => {
        setActiveTabId(defaultTabId);
    }, [defaultTabId]);

    const activeTab = sortedTabs.find(tab => tab.id === activeTabId) ?? null;

    const handleSaving = useCallback((saving: boolean) => {
        setSavingCount((count) => (saving ? count + 1 : Math.max(0, count - 1)));
    }, []);

    const fieldsToRender = activeTab ? activeTab.fields : schema.fields;
    const sortedFields = useMemo(() => sortFields(fieldsToRender), [fieldsToRender, schema.id]);
    const isSaving = savingCount > 0;
    const hasTabs = sortedTabs.length > 0;

    return (
        <div className={`text-fg ${className}`}>
            {hasTabs && (
                <div className="border-b border-edge bg-surface-canvas/60">
                    <div className="flex flex-wrap gap-3 px-3 py-2 text-sm">
                        {sortedTabs.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                className={`px-2 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                                    activeTabId === tab.id
                                        ? "text-fg"
                                        : "text-fg-muted hover:text-fg"
                                }`}
                                onClick={() => setActiveTabId(tab.id)}
                            >
                                {tab.title}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className={`p-4 space-y-4 ${hasTabs ? "pt-5" : ""}`}>
                {sortedFields.map((field) => (
                    <FieldRenderer
                        key={field.id}
                        field={field}
                        data={data}
                        onSaving={handleSaving}
                    />
                ))}

                {schema.showSavingIndicator && isSaving && (
                    <div className="text-xs text-fg-muted text-center">{t("properties.saving")}</div>
                )}
            </div>
        </div>
    );
}

// Memoize the component
export const PropertyEditor = memo(PropertyEditorInner) as typeof PropertyEditorInner;

/**
 * Creates a property editor schema with type safety
 */
export function createPropertyEditorSchema<TData>(
    schema: PropertyEditorSchema<TData>
): PropertyEditorSchema<TData> {
    return schema;
}

/**
 * Helper to create field definitions with proper typing
 */
export function defineField<TData, TField extends FieldDefinition<TData>>(field: TField): TField {
    return field;
}

/**
 * Helper to create a group of fields
 */
export function defineFields<TData>(fields: FieldDefinition<TData>[]): FieldDefinition<TData>[] {
    return fields;
}
