import React from "react";

export type CardVariant = "default" | "elevated" | "outlined" | "ghost";
export type CardSize = "sm" | "md" | "lg";

export interface CardProps {
    variant?: CardVariant;
    size?: CardSize;
    className?: string;
    children: React.ReactNode;
    onClick?: () => void;
    hover?: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
}

const variantStyles: Record<CardVariant, string> = {
    default: "bg-white/5 border border-white/10",
    elevated: "bg-white/10 border border-white/20 shadow-lg shadow-black/20",
    outlined: "bg-transparent border border-white/20",
    ghost: "bg-transparent border border-transparent",
};

const sizeStyles: Record<CardSize, string> = {
    sm: "p-3 rounded-md",
    md: "p-4 rounded-lg",
    lg: "p-6 rounded-lg",
};

/**
 * Card component with VS Code-like styling
 * Provides consistent container styling throughout the app
 */
export function Card({
    variant = "default",
    size = "md",
    className = "",
    children,
    onClick,
    hover = false,
    onFocus,
    onBlur,
}: CardProps) {
    const Component = onClick ? "button" : "div";

    return (
        <Component
            className={`
                ${variantStyles[variant]}
                ${sizeStyles[size]}
                transition-all duration-150 ease-out
                ${hover || onClick ? "hover:bg-white/10 cursor-pointer" : ""}
                ${onClick ? "focus:outline-none focus:ring-0 focus:ring-transparent focus:shadow-none" : ""}
                ${className}
            `}
            onClick={onClick}
            onFocus={onFocus}
            onBlur={onBlur}
        >
            {children}
        </Component>
    );
}

/**
 * Card header component
 */
export function CardHeader({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`mb-3 ${className}`}>
            {children}
        </div>
    );
}

/**
 * Card title component
 */
export function CardTitle({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <h3 className={`text-sm font-semibold text-gray-200 ${className}`}>
            {children}
        </h3>
    );
}

/**
 * Card description component
 */
export function CardDescription({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <p className={`text-xs text-gray-400 mt-1 ${className}`}>
            {children}
        </p>
    );
}

/**
 * Card content component
 */
export function CardContent({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`text-sm text-gray-200 ${className}`}>
            {children}
        </div>
    );
}

/**
 * Card footer component
 */
export function CardFooter({
    className = "",
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`mt-4 pt-3 border-t border-white/10 flex items-center justify-between ${className}`}>
            {children}
        </div>
    );
}

/**
 * Interactive card with hover effects and actions
 */
export function InteractiveCard({
    title,
    description,
    icon,
    actions,
    onClick,
    className = "",
    variant = "default",
    size = "md",
}: {
    title: string;
    description?: string;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
    onClick?: () => void;
    className?: string;
    variant?: CardVariant;
    size?: CardSize;
}) {
    return (
        <Card
            variant={variant}
            size={size}
            onClick={onClick}
            hover={true}
            className={className}
        >
            <div className="flex items-start gap-3">
                {icon && (
                    <div className="flex-shrink-0 mt-0.5 text-gray-400">
                        {icon}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <CardTitle>{title}</CardTitle>
                    {description && <CardDescription>{description}</CardDescription>}
                </div>
                {actions && (
                    <div className="flex-shrink-0 flex items-center gap-1">
                        {actions}
                    </div>
                )}
            </div>
        </Card>
    );
}
