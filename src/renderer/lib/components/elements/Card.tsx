import React from "react";
import { cn } from "../../utils/cn";

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
    default: "bg-fill-subtle border border-edge",
    elevated: "bg-fill border border-edge-strong shadow-lg shadow-black/20",
    outlined: "bg-transparent border border-edge-strong",
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
            className={cn(
                variantStyles[variant],
                sizeStyles[size],
                "transition-all duration-150 ease-out",
                (hover || onClick) && "hover:bg-fill cursor-pointer",
                onClick && "focus:outline-none",
                className,
            )}
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
        <div className={cn("mb-3", className)}>
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
        <h3 className={cn("text-sm font-semibold text-fg", className)}>
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
        <p className={cn("text-xs text-fg-muted mt-1", className)}>
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
        <div className={cn("text-sm text-fg", className)}>
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
        <div className={cn("mt-4 pt-3 border-t border-edge flex items-center justify-between", className)}>
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
                    <div className="flex-shrink-0 mt-0.5 text-fg-muted">
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
