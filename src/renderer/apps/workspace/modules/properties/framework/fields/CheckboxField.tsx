import { useState, useEffect, useCallback, memo, useRef } from "react";
import { CheckboxFieldDefinition } from "../types";

interface CheckboxFieldProps<TData> {
    field: CheckboxFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a checkbox field
 */
function CheckboxFieldInner<TData>({ field, data, onSaving }: CheckboxFieldProps<TData>) {
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

    const handleChange = useCallback(
        async (checked: boolean) => {
            setLocalValue(checked);
            setIsSaving(true);
            onSaving(true);
            try {
                await field.setValue(dataRef.current, checked);
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
        <div className={`flex items-center gap-2 ${field.className || ""}`}>
            <input
                type="checkbox"
                checked={localValue}
                onChange={(e) => handleChange(e.target.checked)}
                disabled={isDisabled}
                className="w-4 h-4 rounded border-white/20 bg-[#1e1f22] text-primary 
                    focus:ring-primary/50 focus:ring-offset-0 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {field.label && <label className="text-sm text-gray-300">{field.label}</label>}
            {field.helpText && <p className="text-xs text-gray-500">{field.helpText}</p>}
        </div>
    );
}

export const CheckboxField = memo(CheckboxFieldInner) as typeof CheckboxFieldInner;
