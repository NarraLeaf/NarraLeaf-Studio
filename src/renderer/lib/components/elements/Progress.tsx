import React from "react";
import { cn } from "../../utils/cn";

export type ProgressVariant = "default" | "success" | "warning" | "error";
export type ProgressSize = "sm" | "md" | "lg";

export interface ProgressProps {
    value?: number;
    max?: number;
    variant?: ProgressVariant;
    size?: ProgressSize;
    className?: string;
    animated?: boolean;
}

const variantStyles: Record<ProgressVariant, string> = {
    default: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    error: "bg-danger",
};

/** CSS color for each variant, for contexts that can't use a Tailwind class (svg stroke, gradient). */
const variantColor: Record<ProgressVariant, string> = {
    default: "var(--narraleaf-accent, #40a8c4)",
    success: "rgb(var(--nl-success))",
    warning: "rgb(var(--nl-warning))",
    error: "rgb(var(--nl-danger))",
};

const sizeStyles: Record<ProgressSize, string> = {
    sm: "h-1",
    md: "h-2",
    lg: "h-3",
};

/**
 * Progress bar component with VS Code-like styling
 * Supports determinate and indeterminate progress
 */
export function Progress({
    value = 0,
    max = 100,
    variant = "default",
    size = "md",
    className = "",
    animated = true,
}: ProgressProps) {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

    return (
        <div className={cn("w-full", className)}>
            <div className={cn("w-full bg-fill rounded-full overflow-hidden", sizeStyles[size])}>
                <div
                    className={cn(
                        "h-full rounded-full transition-all duration-150 ease-out",
                        variantStyles[variant],
                        animated && "animate-pulse",
                    )}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

/**
 * Indeterminate progress bar for loading states
 */
export function ProgressIndeterminate({
    variant = "default",
    size = "md",
    className = "",
}: Omit<ProgressProps, "value" | "max" | "showLabel" | "label" | "animated">) {
    return (
        <div className={cn("w-full bg-fill rounded-full overflow-hidden", sizeStyles[size], className)}>
            <div
                className="h-full rounded-full animate-[progress-indeterminate_2s_ease-in-out_infinite]"
                style={{
                    background: `linear-gradient(90deg, transparent 0%, ${variantColor[variant]} 50%, transparent 100%)`,
                    width: "100%",
                    transform: "translateX(-100%)",
                }}
            />
        </div>
    );
}

/**
 * Circular progress indicator
 */
export function ProgressCircle({
    value = 0,
    max = 100,
    size = 40,
    strokeWidth = 3,
    variant = "default",
    showValue = false,
    className = "",
}: {
    value?: number;
    max?: number;
    size?: number;
    strokeWidth?: number;
    variant?: ProgressVariant;
    showValue?: boolean;
    className?: string;
}) {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const strokeDasharray = circumference;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    return (
        <div className={cn("relative inline-flex items-center justify-center", className)}>
            <svg width={size} height={size} className="transform -rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke="rgb(255 255 255 / 0.1)"
                    strokeWidth={strokeWidth}
                    fill="none"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke={variantColor[variant]}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    className="transition-all duration-150 ease-out"
                />
            </svg>
            {showValue && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-medium text-fg">
                        {Math.round(percentage)}%
                    </span>
                </div>
            )}
        </div>
    );
}
