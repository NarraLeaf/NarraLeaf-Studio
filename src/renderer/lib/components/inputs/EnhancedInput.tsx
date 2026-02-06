import {
    useState,
    useCallback,
    type ChangeEvent,
    type FocusEvent,
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
    ...rest
}: EnhancedInputProps) {
    const [hasFocus, setHasFocus] = useState(false);

    const handleChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => {
            onChange(event.target.value);
        },
        [onChange]
    );

    const handleFocus = useCallback(
        (event: FocusEvent<HTMLInputElement>) => {
            setHasFocus(true);
            onFocus?.(event);
        },
        [onFocus]
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

    return (
        <div
            className={`
                relative flex items-center bg-[#1e1f22] border border-white/10 rounded-md text-sm
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
                value={value}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                className={`
                    flex-1 bg-transparent border-none placeholder:text-gray-500 text-gray-100 focus:outline-none
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
