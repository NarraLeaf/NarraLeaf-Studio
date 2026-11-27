import { evaluateNumericInput, stepNumber } from "./numericExpression";
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
import { isImeKeyEvent } from "@/lib/utils/imeComposition";

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
        const parsed = evaluateNumericInput(localValue) ?? Number.NaN;
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

    // Escape leaves the field without writing what was typed. It used to only mark the field as not
    // focused while the caret stayed in it: the old value showed, the next keystrokes went into the
    // hidden draft, and the blur that followed wrote that - "100", type "5", click away, 1005.
    const discardOnBlurRef = useRef(false);
    const handleBlur = useCallback(
        async (event: FocusEvent<HTMLInputElement>) => {
            if (discardOnBlurRef.current) {
                discardOnBlurRef.current = false;
                setLocalValue(numberToFullDisplayString(lastExternalValueRef.current));
            } else {
                await handleCommit();
            }
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
            if (isImeKeyEvent(event)) {
                return;
            }
            if (event.key === "Enter") {
                event.preventDefault();
                void handleCommit();
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                discardOnBlurRef.current = true;
                event.currentTarget.blur();
            } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !disabled && !readOnly) {
                // A text field, so the steps are this field's own: 1 (or `step`), ×10 with Shift.
                const current = evaluateNumericInput(localValue);
                if (current !== null) {
                    event.preventDefault();
                    const unit = typeof step === "number" && step > 0 ? step : 1;
                    let next = stepNumber(current, (event.key === "ArrowUp" ? 1 : -1) * unit * (event.shiftKey ? 10 : 1));
                    if (typeof min === "number") next = Math.max(min, next);
                    if (typeof max === "number") next = Math.min(max, next);
                    setLocalValue(numberToFullDisplayString(next));
                    void Promise.resolve(onCommit(next)).then(() => {
                        lastExternalValueRef.current = next;
                    });
                }
            }
            onKeyDown?.(event);
        },
        [disabled, handleCommit, localValue, max, min, onCommit, onKeyDown, readOnly, step]
    );

    return (
        <input
            // Text rather than a native number box, which reports "" for half-typed input such as a
            // lone minus sign and cannot take arithmetic.
            type="text"
            inputMode="decimal"
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
