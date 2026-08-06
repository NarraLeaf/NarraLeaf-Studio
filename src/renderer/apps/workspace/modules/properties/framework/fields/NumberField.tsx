import { useState, useCallback, memo } from "react";
import { NumberFieldDefinition } from "../types";
import { DeferredNumberInput } from "@/lib/components/inputs/DeferredNumberInput";
import { FIELD_INPUT_CLASS } from "../../fieldControlClass";

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
                <label className="block text-xs font-medium text-fg-muted mb-1">
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
                inputClassName={`w-full ${FIELD_INPUT_CLASS}
                    [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                    ${field.className || ""}`}
                onSaving={handleSaving}
                formatValue={formatValue}
            />
            {field.helpText && (
                <p className="mt-1 text-xs text-fg-subtle">{field.helpText}</p>
            )}
        </div>
    );
}

export const NumberField = memo(NumberFieldInner) as typeof NumberFieldInner;
