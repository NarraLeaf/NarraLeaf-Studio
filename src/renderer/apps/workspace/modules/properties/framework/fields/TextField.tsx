import { useState, useEffect, useCallback, memo, useRef } from "react";
import { TextFieldDefinition, TextareaFieldDefinition } from "../types";

interface TextFieldProps<TData> {
    field: TextFieldDefinition<TData> | TextareaFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

/**
 * Renders a text input or textarea field
 */
function TextFieldInner<TData>({ field, data, onSaving }: TextFieldProps<TData>) {
    const currentValue = field.getValue(data);
    const [localValue, setLocalValue] = useState(currentValue);
    const [isSaving, setIsSaving] = useState(false);
    const dataRef = useRef(data);
    dataRef.current = data;

    // Only sync when the external value actually changes
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

    const inputClassName = `w-full px-3 py-2 bg-[#1e1f22] border border-white/10 rounded-md text-sm text-gray-300 
        focus:outline-none focus:border-primary/50 transition-colors 
        disabled:opacity-50 disabled:cursor-not-allowed ${field.className || ""}`;

    if (field.type === "textarea") {
        const textareaField = field as TextareaFieldDefinition<TData>;
        return (
            <div>
                {field.label && (
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                        {field.label}
                    </label>
                )}
                <textarea
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onBlur={handleBlur}
                    rows={textareaField.rows ?? 4}
                    maxLength={textareaField.maxLength}
                    placeholder={field.placeholder}
                    disabled={isDisabled}
                    readOnly={isReadOnly}
                    className={`${inputClassName} resize-none`}
                />
                {field.helpText && (
                    <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
                )}
            </div>
        );
    }

    const textField = field as TextFieldDefinition<TData>;
    return (
        <div>
            {field.label && (
                <label className="block text-xs font-medium text-gray-400 mb-1">
                    {field.label}
                </label>
            )}
            <input
                type="text"
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                maxLength={textField.maxLength}
                placeholder={field.placeholder}
                disabled={isDisabled}
                readOnly={isReadOnly}
                className={inputClassName}
            />
            {field.helpText && (
                <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>
            )}
        </div>
    );
}

export const TextField = memo(TextFieldInner) as typeof TextFieldInner;
