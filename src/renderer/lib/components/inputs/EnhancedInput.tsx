import {
    useState,
    useCallback,
    useMemo,
    type ChangeEvent,
    type FocusEvent,
    type MouseEvent,
    type InputHTMLAttributes,
    type ReactNode,
} from "react";

export interface EnhancedInputProps
    extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
    value: string;
    onChange: (value: string) => void;
    unit?: string;
    leftIcon?: ReactNode;
    className?: string;
    inputClassName?: string;
    precision?: number | null;
    selectAllOnFocus?: boolean;
}

/**
 * Enhanced input that can show a unit suffix, a leading icon, and hides the unit while focused.
 */
export function EnhancedInput({
    value,
    onChange,
    unit,
    leftIcon,
    className = "",
    inputClassName = "",
    onFocus,
    onBlur,
    precision,
    selectAllOnFocus = false,
    ...rest
}: EnhancedInputProps) {
    const [hasFocus, setHasFocus] = useState(false);
    const roundingPrecision = precision === undefined ? 1 : precision;
    const displayValue = useMemo(() => {
        if (hasFocus) {
            return value;
        }
        if (roundingPrecision !== null && typeof roundingPrecision === "number") {
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed)) {
                return parsed.toFixed(roundingPrecision);
            }
        }
        return value;
    }, [hasFocus, roundingPrecision, value]);

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
        },
        [onChange]
    );

    const handleFocus = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setHasFocus(true);
            if (selectAllOnFocus) {
                setTimeout(() => event.target.select(), 0);
            }
            onFocus?.(event);
        },
        [onFocus, selectAllOnFocus]
    );

    const handleMouseUp = useCallback(
        (event: MouseEvent<HTMLInputElement>) => {
            if (selectAllOnFocus) {
                event.preventDefault();
                event.currentTarget.select();
            }
        },
        [selectAllOnFocus]
    );

    const handleBlur = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setHasFocus(false);
            onBlur?.(event);
        },
        [onBlur]
    );

    const paddingLeftClass = leftIcon ? "pl-10" : "pl-3";
    const paddingRightClass = unit ? "pr-10" : "pr-3";
    const numberNoSpinnerClass =
        rest.type === "number"
            ? "[appearance:textfield] [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            : "";

    return (
        <div
            className={`
                relative flex min-w-0 max-w-full items-center bg-[#1e1f22] border border-white/10 rounded-md text-sm h-9 min-h-[34px] overflow-hidden
                focus-within:border-primary/70 transition focus-within:ring-1 focus-within:ring-primary/30
                ${className}
            `}
        >
            {leftIcon && (
                <span className="absolute left-2 text-gray-400 pointer-events-none flex items-center">
                    {leftIcon}
                </span>
            )}

            <input
                value={displayValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onMouseUp={handleMouseUp}
                className={`
                    min-w-0 flex-1 h-full bg-transparent border-none placeholder:text-gray-500 text-gray-100 focus:outline-none leading-none overflow-hidden text-ellipsis whitespace-nowrap
                    ${numberNoSpinnerClass}
                    ${paddingLeftClass} ${paddingRightClass} ${inputClassName}
                `}
                {...rest}
            />

            {unit && !hasFocus && (
                <span className="absolute right-2 text-xs text-gray-500 pointer-events-none select-none">
                    {unit}
                </span>
            )}
        </div>
    );
}
