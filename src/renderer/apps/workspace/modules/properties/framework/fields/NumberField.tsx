import { useState, useCallback, memo } from "react";
import { NumberFieldDefinition } from "../types";
import { DeferredNumberInput } from "@/lib/components/inputs/DeferredNumberInput";

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
    const [isSaving, setIsSaving] = useState(false);
    const decimalPlaces = field.decimalPlaces;
    const formatValue =
        typeof decimalPlaces === "number"
            ? (value: number) => value.toFixed(decimalPlaces)
            : undefined;

    const handleSaving = useCallback(
        (saving: boolean) => {
            setIsSaving(saving);
            onSaving(saving);
        },
        [onSaving]
    );

    const handleCommit = useCallback(
        (value: number) => {
            return field.setValue(data, value);
        },
        [field, data]
    );

    const isDisabled = field.disabled || isSaving;
    const isReadOnly = field.readOnly;

    return (
        <div>
            {field.label && (
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    {field.label}
                </label>
            )}
            <DeferredNumberInput
                value={currentValue}
                onCommit={handleCommit}
                min={field.min}
                max={field.max}
                step={field.step}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                inputClassName={`w-full px-3 py-2 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 
                    focus:outline-none focus:border-primary/50 transition-colors 
                    disabled:opacity-50 disabled:cursor-not-allowed ${field.className || ""}`}
                onSaving={handleSaving}
                formatValue={formatValue}
            />
            {field.helpText && (
                <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
        </div>
    );
}

export const NumberField = memo(NumberFieldInner) as typeof NumberFieldInner;
