import { memo, useMemo } from "react";
import { FieldDefinition } from "../types";
import { TextField } from "./TextField";
import { NumberField } from "./NumberField";
import { CheckboxField } from "./CheckboxField";
import { SelectField } from "./SelectField";
import { TagsField } from "./TagsField";
import { InfoField } from "./InfoField";
import { SectionField } from "./SectionField";
import { ThumbnailField } from "./ThumbnailField";

interface FieldRendererProps<TData> {
    field: FieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders the appropriate field component based on field type
 */
function FieldRendererInner<TData>({ field, data, onSaving }: FieldRendererProps<TData>) {
    // Check if field should be hidden
    const isHidden = useMemo(() => {
        if (field.hidden === undefined) return false;
        if (typeof field.hidden === "function") {
            return field.hidden(data);
        }
        return field.hidden;
    }, [field.hidden, field.id, data]);

    if (isHidden) {
        return null;
    }

    switch (field.type) {
        case "text":
        case "textarea":
            return <TextField field={field} data={data} onSaving={onSaving} />;

        case "number":
            return <NumberField field={field} data={data} onSaving={onSaving} />;

        case "checkbox":
            return <CheckboxField field={field} data={data} onSaving={onSaving} />;

        case "select":
            return <SelectField field={field} data={data} onSaving={onSaving} />;

        case "tags":
            return <TagsField field={field} data={data} onSaving={onSaving} />;

        case "info":
            return <InfoField field={field} data={data} />;

        case "section":
            return <SectionField field={field} data={data} onSaving={onSaving} />;

        case "thumbnail":
            return <ThumbnailField field={field} data={data} onSaving={onSaving} />;

        case "custom": {
            const CustomComponent = field.component;
            return (
                <div className={field.className}>
                    {field.label && (
                        <label className="block text-xs font-medium text-gray-400 mb-1">
                            {field.label}
                        </label>
                    )}
                    <CustomComponent
                        data={data}
                        onChange={() => {
                            // Custom components handle their own state
                        }}
                        disabled={field.disabled}
                        readOnly={field.readOnly}
                    />
                </div>
            );
        }

        default:
            return null;
    }
}

// Memoize to prevent unnecessary re-renders
export const FieldRenderer = memo(FieldRendererInner) as typeof FieldRendererInner;
