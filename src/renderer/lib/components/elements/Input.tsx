import React from "react";
import { cn } from "../../utils/cn";

export type InputVariant = "default" | "error" | "success";
export type InputSize = "sm" | "md" | "lg";

export interface BaseInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
    variant?: InputVariant;
    size?: InputSize;
    fullWidth?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    onRightIconClick?: () => void;
}

const variantStyles: Record<InputVariant, string> = {
    default: "border-edge-strong focus:border-primary",
    error: "border-danger/50 focus:border-danger",
    success: "border-success/50 focus:border-success",
};

const sizeStyles: Record<InputSize, string> = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
    lg: "px-4 py-2 text-base",
};

const inputBase = "w-full bg-fill-subtle border rounded-md text-fg placeholder-fg-subtle "
    + "focus:outline-none transition-all duration-150 ease-out "
    + "disabled:opacity-50 disabled:cursor-not-allowed cursor-text";

/**
 * Text input component with VS Code-like styling
 */
export function Input({
    variant = "default",
    size = "md",
    className = "",
    fullWidth = false,
    leftIcon,
    rightIcon,
    onRightIconClick,
    ...props
}: BaseInputProps) {
    return (
        <div className={cn("relative", fullWidth && "w-full")}>
            {leftIcon && (
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <div className="text-fg-muted">{leftIcon}</div>
                </div>
            )}
            <input
                className={cn(
                    inputBase,
                    leftIcon && "pl-10",
                    rightIcon && "pr-10",
                    variantStyles[variant],
                    sizeStyles[size],
                    className,
                )}
                {...props}
            />
            {rightIcon && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <button
                        type="button"
                        onClick={onRightIconClick}
                        className="text-fg-muted hover:text-fg transition-colors cursor-default"
                    >
                        {rightIcon}
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * Multi-line text area component
 */
export function TextArea({
    variant = "default",
    size = "md",
    className = "",
    fullWidth = false,
    rows = 3,
    ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    variant?: InputVariant;
    size?: InputSize;
    fullWidth?: boolean;
    rows?: number;
}) {
    return (
        <textarea
            rows={rows}
            className={cn(
                inputBase,
                "resize-vertical",
                variantStyles[variant],
                sizeStyles[size],
                fullWidth && "w-full",
                className,
            )}
            {...props}
        />
    );
}

/**
 * Search input with built-in search icon
 */
export function SearchInput({
    size = "md",
    className = "",
    fullWidth = false,
    ...props
}: Omit<BaseInputProps, "leftIcon" | "rightIcon" | "onRightIconClick">) {
    return (
        <Input
            size={size}
            fullWidth={fullWidth}
            className={className}
            leftIcon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            }
            {...props}
        />
    );
}

/**
 * Input with label component
 */
export function InputGroup({
    label,
    error,
    helper,
    required,
    className = "",
    children,
}: {
    label?: string;
    error?: string;
    helper?: string;
    required?: boolean;
    className?: string;
    children: React.ReactNode;
}) {
    const inputVariant = error ? "error" : "default";

    return (
        <div className={cn("space-y-1", className)}>
            {label && (
                <label className="block text-sm font-medium text-fg">
                    {label}
                    {required && <span className="text-danger ml-1">*</span>}
                </label>
            )}
            <div>
                {React.isValidElement(children)
                    ? React.cloneElement(children, { variant: inputVariant } as any)
                    : children
                }
            </div>
            {error && (
                <p className="text-xs text-danger">{error}</p>
            )}
            {helper && !error && (
                <p className="text-xs text-fg-muted">{helper}</p>
            )}
        </div>
    );
}
