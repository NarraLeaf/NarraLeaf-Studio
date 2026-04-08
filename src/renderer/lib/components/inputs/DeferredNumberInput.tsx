import {
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
    type ChangeEvent,
    type FocusEvent,
    type KeyboardEvent,
    type InputHTMLAttributes,
} from "react";

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown">;

/** Full-precision string for editing; avoids scientific notation for typical UI numbers. */
function numberToFullDisplayString(n: number): string {
    if (!Number.isFinite(n)) {
        return "";
    }
    return String(n);
}

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
    /** When set, unfocused display uses this formatter (e.g. toFixed). Focused shows full stored value. */
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
    const formatBlurredDisplay = useCallback(
        (nextValue: number) => {
            if (!Number.isFinite(nextValue)) {
                return "";
            }
            return formatValue ? formatValue(nextValue) : String(nextValue);
        },
        [formatValue]
    );

    const [hasFocus, setHasFocus] = useState(false);
    const [localValue, setLocalValue] = useState(() => numberToFullDisplayString(value));
    const [isSaving, setIsSaving] = useState(false);
    const lastExternalValueRef = useRef(value);

    const displayValue = useMemo(() => {
        if (hasFocus) {
            return localValue;
        }
        return formatBlurredDisplay(value);
    }, [hasFocus, localValue, value, formatBlurredDisplay]);

    useEffect(() => {
        lastExternalValueRef.current = value;
        if (hasFocus) {
            setLocalValue(numberToFullDisplayString(value));
        }
    }, [value, hasFocus]);

    const handleCommit = useCallback(async () => {
        if (disabled || readOnly || isSaving) {
            return;
        }
        const parsed = Number.parseFloat(localValue);
        if (!Number.isFinite(parsed)) {
            setLocalValue(numberToFullDisplayString(lastExternalValueRef.current));
            return;
        }
        if (parsed === lastExternalValueRef.current) {
            setLocalValue(numberToFullDisplayString(parsed));
            return;
        }
        setIsSaving(true);
        onSaving?.(true);
        try {
            await Promise.resolve(onCommit(parsed));
            lastExternalValueRef.current = parsed;
            setLocalValue(numberToFullDisplayString(parsed));
        } catch (error) {
            console.error("DeferredNumberInput: commit failed", error);
            setLocalValue(numberToFullDisplayString(lastExternalValueRef.current));
        } finally {
            setIsSaving(false);
            onSaving?.(false);
        }
    }, [disabled, readOnly, isSaving, localValue, onCommit, onSaving]);

    const { onBlur, onChange, onKeyDown, onFocus, ...restInputProps } =
        (inputProps as InputHTMLAttributes<HTMLInputElement>) ?? {};

    const handleFocus = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setHasFocus(true);
            setLocalValue(numberToFullDisplayString(value));
            onFocus?.(event);
        },
        [onFocus, value]
    );

    const handleBlur = useCallback(
        async (event: FocusEvent<HTMLInputElement>) => {
            await handleCommit();
            setHasFocus(false);
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
                void handleCommit();
            } else if (event.key === "Escape") {
                event.preventDefault();
                setLocalValue(numberToFullDisplayString(value));
                setHasFocus(false);
            }
            onKeyDown?.(event);
        },
        [handleCommit, onKeyDown, value]
    );

    return (
        <input
            type="number"
            value={displayValue}
            min={min}
            max={max}
            step={step}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            className={inputClassName}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            {...restInputProps}
        />
    );
}
