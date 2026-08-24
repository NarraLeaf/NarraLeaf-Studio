import React from "react";
import { cn } from "../../utils/cn";
import { FieldLabel } from "./FieldLabel";

/**
 * `title` is this card's heading and shadows the DOM attribute of the same name, which is why
 * it is omitted below. Every other attribute reaches the root element, so a caller can hang a
 * `data-*` hook or an aria attribute on a card without the component learning about it.
 */
export interface SectionCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Optional eyebrow title rendered in a bordered header row. */
    title?: React.ReactNode;
    /** Optional actions aligned to the right of the header. */
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    bodyClassName?: string;
}

/**
 * Bordered content section. Canonicalizes the
 * `rounded-md border border-white/10 bg-white/[0.02~0.03]` cards hand-rolled
 * across project settings / launcher panels.
 */
export function SectionCard({ title, actions, children, className, bodyClassName, ...props }: SectionCardProps) {
    return (
        <div className={cn("rounded-md border border-edge bg-fill-subtle", className)} {...props}>
            {(title || actions) && (
                <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
                    {title ? <FieldLabel as="div" className="mb-0">{title}</FieldLabel> : <span />}
                    {actions}
                </div>
            )}
            <div className={cn("p-3", bodyClassName)}>{children}</div>
        </div>
    );
}
