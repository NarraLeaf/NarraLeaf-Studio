import { useState, useEffect, useCallback, memo, useRef } from "react";
import { Switch } from "@/lib/components/elements";
import { ToggleFieldDefinition } from "../types";

interface ToggleFieldProps<TData> {
    field: ToggleFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a boolean field as the shared switch — the control every other on/off setting in Studio
 * uses. (A checkbox would say something else: that this is one member of a set. See `Checkbox`.)
 */
function ToggleFieldInner<TData>({ field, data, onSaving }: ToggleFieldProps<TData>) {
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
            <Switch
                size="sm"
                checked={localValue}
                onCheckedChange={handleChange}
                disabled={isDisabled}
                aria-label={field.label}
            />
            {field.label && <span className="text-sm text-fg-muted">{field.label}</span>}
            {field.helpText && <p className="text-xs text-fg-subtle">{field.helpText}</p>}
        </div>
    );
}

export const ToggleField = memo(ToggleFieldInner) as typeof ToggleFieldInner;
