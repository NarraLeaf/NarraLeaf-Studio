import React from "react";
import { cn } from "../../utils/cn";

export interface FieldLabelProps extends React.HTMLAttributes<HTMLElement> {
    /** Render as a different element (e.g. "div" when not tied to an input). Defaults to "label". */
    as?: "label" | "span" | "div";
    children: React.ReactNode;
}

/**
 * Small eyebrow-style field label. Replaces the ad-hoc
 * `text-[10px|11px] font-medium tracking-wide text-slate-500` /
 * `FIELD_LABEL_CLASS` strings duplicated across editors.
 */
export function FieldLabel({ as: Tag = "label", className, children, ...props }: FieldLabelProps) {
    return (
        <Tag
            className={cn("mb-1 block text-2xs font-medium tracking-wide text-fg-subtle", className)}
            {...(props as React.HTMLAttributes<HTMLElement>)}
        >
            {children}
        </Tag>
    );
}
