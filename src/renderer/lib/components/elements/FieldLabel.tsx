import React from "react";
import { cn } from "../../utils/cn";
import { textLevelClass, type TextDensity } from "./textLevels";

export interface FieldLabelProps extends React.HTMLAttributes<HTMLElement> {
    /** Render as a different element (e.g. "div" when not tied to an input). Defaults to "label". */
    as?: "label" | "span" | "div";
    /** `panel` (11px) in side panels and the inspector, `page` (12px) in dialogs and the settings window. */
    density?: TextDensity;
    children: React.ReactNode;
}

/**
 * The name above or beside a control: the `label` level of docs/design-system.md §4.1.
 *
 * Muted and regular weight, so it never reads as the heading of the group it sits in. A group's
 * heading is a `SectionTitle`.
 */
export function FieldLabel({ as: Tag = "label", density = "panel", className, children, ...props }: FieldLabelProps) {
    return (
        <Tag
            className={cn("mb-1 block", textLevelClass("label", density), className)}
            {...(props as React.HTMLAttributes<HTMLElement>)}
        >
            {children}
        </Tag>
    );
}
