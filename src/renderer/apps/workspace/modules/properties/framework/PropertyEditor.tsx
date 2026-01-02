import { useState, useCallback, useMemo, memo } from "react";
import { PropertyEditorSchema, FieldDefinition } from "./types";
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
function PropertyEditorInner<TData>({
    schema,
    data,
    onChange,
    className = "",
}: PropertyEditorProps<TData>) {
    const [savingCount, setSavingCount] = useState(0);

    const handleSaving = useCallback((saving: boolean) => {
        setSavingCount((count) => (saving ? count + 1 : Math.max(0, count - 1)));
    }, []);

    // Sort fields by order - use schema.id as stable key
    const sortedFields = useMemo(() => {
        return [...schema.fields].sort((a, b) => {
            const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
            const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
            return orderA - orderB;
        });
    }, [schema.id, schema.fields.length]);

    const isSaving = savingCount > 0;

    return (
        <div className={`p-4 space-y-4 text-gray-200 ${className}`}>
            {sortedFields.map((field) => (
                <FieldRenderer
                    key={field.id}
                    field={field}
                    data={data}
                    onSaving={handleSaving}
                />
            ))}

            {schema.showSavingIndicator && isSaving && (
                <div className="text-xs text-gray-400 text-center">Saving...</div>
            )}
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
