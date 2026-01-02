import { useState, useEffect, useCallback, memo, useRef } from "react";
import { NumberFieldDefinition } from "../types";

interface NumberFieldProps<TData> {
    field: NumberFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a number input field
 */
function NumberFieldInner<TData>({ field, data, onSaving }: NumberFieldProps<TData>) {
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

    const handleBlur = useCallback(async () => {
        const current = field.getValue(dataRef.current);
        if (localValue !== current) {
            setIsSaving(true);
            onSaving(true);
            try {
                await field.setValue(dataRef.current, localValue);
            } catch (err) {
                console.error(`Failed to save field ${field.id}:`, err);
                setLocalValue(current);
            } finally {
                setIsSaving(false);
                onSaving(false);
            }
        }
    }, [field.id, field.getValue, field.setValue, localValue, onSaving]);

    const isDisabled = field.disabled || isSaving;
    const isReadOnly = field.readOnly;

    return (
        <div>
            {field.label && (
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    {field.label}
                </label>
            )}
            <input
                type="number"
                value={localValue}
                onChange={(e) => setLocalValue(parseFloat(e.target.value) || 0)}
                onBlur={handleBlur}
                min={field.min}
                max={field.max}
                step={field.step}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={`w-full px-3 py-2 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 
                    focus:outline-none focus:border-primary/50 transition-colors 
                    disabled:opacity-50 disabled:cursor-not-allowed ${field.className || ""}`}
            />
            {field.helpText && (
                <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
        </div>
    );
}

export const NumberField = memo(NumberFieldInner) as typeof NumberFieldInner;
