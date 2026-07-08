import React from "react";
import { cn } from "../../utils/cn";

export type BadgeTone = "neutral" | "primary" | "binding" | "danger" | "success" | "warning";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    tone?: BadgeTone;
    children: React.ReactNode;
}

const toneStyles: Record<BadgeTone, string> = {
    neutral: "border-edge bg-fill-subtle text-fg-muted",
    primary: "border-primary/30 bg-primary/10 text-primary",
    binding: "border-binding/30 bg-binding/10 text-binding",
    danger: "border-danger/40 bg-danger/10 text-danger",
    success: "border-success/30 bg-success/10 text-success",
    warning: "border-warning/30 bg-warning/10 text-warning",
};

/**
 * Small status/label pill. Replaces the ad-hoc
 * `rounded px-1.5 py-0.5 text-2xs border …` chips scattered across the app.
 */
export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium leading-none",
                toneStyles[tone],
                className,
            )}
            {...props}
        >
            {children}
        </span>
    );
}
