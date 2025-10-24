import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children: React.ReactNode;
    fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
    primary: "bg-[#40a8c4] text-white hover:bg-[#4fb8d4] focus:ring-[#40a8c4]/30 focus:shadow-lg focus:shadow-[#40a8c4]/20",
    secondary: "bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white focus:ring-white/20 focus:shadow-lg focus:shadow-white/10",
    ghost: "text-gray-300 hover:bg-white/10 hover:text-white focus:ring-white/10 focus:shadow-lg focus:shadow-white/10",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30 focus:shadow-lg focus:shadow-red-500/20",
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
            className={`
                inline-flex items-center justify-center gap-2 rounded-md font-medium
                transition-all duration-150 ease-out focus:outline-none focus:ring-0
                disabled:opacity-50 disabled:cursor-not-allowed cursor-default
                ${variantStyles[variant]}
                ${sizeStyles[size]}
                ${fullWidth ? "w-full" : ""}
                ${className}
            `}
            style={{
                outline: 'none'
            }}
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
}) {
    const iconSizeStyles: Record<ButtonSize, string> = {
        sm: "w-8 h-8",
        md: "w-10 h-10",
        lg: "w-12 h-12",
    };

    return (
        <button
            className={`
                grid place-items-center rounded-md
                transition-all duration-150 ease-out focus:outline-none focus:ring-0
                disabled:opacity-50 disabled:cursor-not-allowed cursor-default
                ${variantStyles[variant]}
                ${iconSizeStyles[size]}
                ${className}
            `}
            style={{
                outline: 'none'
            }}
            aria-label={ariaLabel}
            title={title}
            {...props}
        />
    );
}
