import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { SelectFieldDefinition } from "../types";
import { Select } from "@/lib/components/elements";

interface SelectFieldProps<TData> {
    field: SelectFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a select dropdown field
 */
function SelectFieldInner<TData>({ field, data, onSaving }: SelectFieldProps<TData>) {
    const currentValue = field.getValue(data);
    const [localValue, setLocalValue] = useState(currentValue);
    const [isSaving, setIsSaving] = useState(false);
    const dataRef = useRef(data);
    dataRef.current = data;

    useEffect(() => {
        if (!isSaving) {
            setLocalValue(currentValue);
        }
    }, [currentValue, isSaving]);

    const options = useMemo(() => {
        if (typeof field.options === "function") {
            return field.options(data);
        }
        return field.options;
    }, [field.options, data]);

    const handleChange = useCallback(
        async (value: string | number) => {
            setLocalValue(value);
            setIsSaving(true);
            onSaving(true);
            try {
                await field.setValue(dataRef.current, value);
            } catch (err) {
                console.error(`Failed to save field ${field.id}:`, err);
                setLocalValue(field.getValue(dataRef.current));
            } finally {
                setIsSaving(false);
                onSaving(false);
            }
        },
        [field.id, field.getValue, field.setValue, onSaving]
    );

    const isDisabled = field.disabled || isSaving;

    return (
        <div className={field.className}>
            {field.label && (
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    {field.label}
                </label>
            )}
            <Select
                fullWidth
                options={options}
                value={localValue}
                onChange={handleChange}
                placeholder={field.placeholder}
                disabled={isDisabled}
            />
            {field.helpText && (
                <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
        </div>
    );
}

export const SelectField = memo(SelectFieldInner) as typeof SelectFieldInner;
