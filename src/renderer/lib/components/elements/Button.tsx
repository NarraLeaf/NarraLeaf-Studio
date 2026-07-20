import React from "react";
import { cn } from "../../utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children: React.ReactNode;
    fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
    primary: "bg-primary text-on-primary hover:brightness-110",
    secondary: "bg-fill text-fg-muted hover:bg-fill-strong hover:text-fg",
    ghost: "text-fg-muted hover:bg-fill hover:text-fg",
    danger: "bg-danger text-white hover:brightness-110",
};

const sizeStyles: Record<ButtonSize, string> = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-2 text-sm",
    lg: "px-4 py-2 text-base",
};

/**
 * Universal button component with consistent styling
 * Follows VS Code-like design with subtle animations
 */
export function Button({
    variant = "secondary",
    size = "md",
    children,
    className = "",
    fullWidth = false,
    ...props
}: ButtonProps) {
    return (
        <button
            className={cn(
                "inline-flex items-center justify-center gap-2 rounded-md font-medium",
                "transition-all duration-150 ease-out focus:outline-none",
                "disabled:opacity-50 disabled:cursor-not-allowed cursor-default",
                variantStyles[variant],
                sizeStyles[size],
                fullWidth && "w-full",
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}

/**
 * Icon-only button variant
 */
export function IconButton({
    variant = "ghost",
    size = "md",
    className = "",
    "aria-label": ariaLabel,
    title,
    ...props
}: Omit<ButtonProps, "children"> & {
    "aria-label": string;
    title?: string;
    /**
     * Optional icon content. Omitted from ButtonProps to drop its `required`,
     * then re-added as optional: the spread below already forwards children to
     * the button, so forbidding them outright contradicted the runtime.
     */
    children?: React.ReactNode;
}) {
    const iconSizeStyles: Record<ButtonSize, string> = {
        sm: "w-8 h-8",
        md: "w-10 h-10",
        lg: "w-12 h-12",
    };

    return (
        <button
            className={cn(
                "grid place-items-center rounded-md",
                "transition-all duration-150 ease-out focus:outline-none",
                "disabled:opacity-50 disabled:cursor-not-allowed cursor-default",
                variantStyles[variant],
                iconSizeStyles[size],
                className,
            )}
            aria-label={ariaLabel}
            title={title}
            {...props}
        />
    );
}
