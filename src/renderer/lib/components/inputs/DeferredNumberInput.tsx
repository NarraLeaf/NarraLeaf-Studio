import {
    useState,
    useEffect,
    useRef,
    useCallback,
    type ChangeEvent,
    type FocusEvent,
    type KeyboardEvent,
    type InputHTMLAttributes,
} from "react";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown">;

export interface DeferredNumberInputProps {
    value: number;
    onCommit: (value: number) => void | Promise<void>;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    inputClassName?: string;
    onSaving?: (saving: boolean) => void;
    formatValue?: (value: number) => string;
    inputProps?: InputProps;
}

export function DeferredNumberInput({
    value,
    onCommit,
    min,
    max,
    step,
    placeholder,
    disabled = false,
    readOnly = false,
    inputClassName = "",
    onSaving,
    formatValue,
    inputProps,
}: DeferredNumberInputProps) {
    const formatDisplayValue = useCallback(
        (nextValue: number) => {
            if (!Number.isFinite(nextValue)) {
                return "";
            }
            return formatValue ? formatValue(nextValue) : String(nextValue);
        },
        [formatValue]
    );

    const [localValue, setLocalValue] = useState(() => formatDisplayValue(value));
    const [isSaving, setIsSaving] = useState(false);
    const lastExternalValueRef = useRef(value);

    useEffect(() => {
        if (value === lastExternalValueRef.current) {
            return;
        }
        lastExternalValueRef.current = value;
        setLocalValue(formatDisplayValue(value));
    }, [value, formatDisplayValue]);

    const handleCommit = useCallback(async () => {
        if (disabled || readOnly || isSaving) {
            return;
        }
        const parsed = Number.parseFloat(localValue);
        if (!Number.isFinite(parsed)) {
            setLocalValue(formatDisplayValue(lastExternalValueRef.current));
            return;
        }
        if (parsed === lastExternalValueRef.current) {
            setLocalValue(formatDisplayValue(parsed));
            return;
        }
        setIsSaving(true);
        onSaving?.(true);
        try {
            await Promise.resolve(onCommit(parsed));
            lastExternalValueRef.current = parsed;
            setLocalValue(formatDisplayValue(parsed));
        } catch (error) {
            console.error("DeferredNumberInput: commit failed", error);
            setLocalValue(formatDisplayValue(lastExternalValueRef.current));
        } finally {
            setIsSaving(false);
            onSaving?.(false);
        }
    }, [disabled, readOnly, isSaving, localValue, onCommit, onSaving, formatDisplayValue]);

    const { onBlur, onChange, onKeyDown, ...restInputProps } = inputProps as InputHTMLAttributes<HTMLInputElement> ?? {};

    const handleBlur = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            handleCommit();
            onBlur?.(event);
        },
        [handleCommit, onBlur]
    );

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            setLocalValue(event.target.value);
            onChange?.(event);
        },
        [onChange]
    );

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
                event.preventDefault();
                handleCommit();
            } else if (event.key === "Escape") {
                event.preventDefault();
                setLocalValue(formatDisplayValue(lastExternalValueRef.current));
            }
            onKeyDown?.(event);
        },
        [handleCommit, onKeyDown, formatDisplayValue]
    );

    return (
        <input
            type="number"
            value={localValue}
            min={min}
            max={max}
            step={step}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            className={inputClassName}
            onBlur={handleBlur}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            {...restInputProps}
        />
    );
}
