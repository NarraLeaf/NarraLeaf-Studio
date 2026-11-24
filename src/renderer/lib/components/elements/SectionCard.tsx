import React from "react";
import { cn } from "../../utils/cn";
import { textLevelClass } from "./textLevels";

/**
 * `title` is this card's heading and shadows the DOM attribute of the same name, which is why
 * it is omitted below. Every other attribute reaches the root element, so a caller can hang a
 * `data-*` hook or an aria attribute on a card without the component learning about it.
 */
export interface SectionCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Optional title rendered in a bordered header row, at the `item` level with semibold weight. */
    title?: React.ReactNode;
    /** Optional actions aligned to the right of the header. */
    actions?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    bodyClassName?: string;
}

/**
 * Bordered content section: the second and last container level (docs/design-system.md §4.1).
 * A card never holds another card.
 */
export function SectionCard({ title, actions, children, className, bodyClassName, ...props }: SectionCardProps) {
    return (
        <div className={cn("rounded-md border border-edge bg-fill-subtle", className)} {...props}>
            {(title || actions) && (
                <div className="flex items-center justify-between gap-2 border-b border-edge-subtle px-3 py-2">
                    {title ? <div className={cn("min-w-0 font-semibold", textLevelClass("item"))}>{title}</div> : <span />}
                    {actions}
                </div>
            )}
            <div className={cn("p-3", bodyClassName)}>{children}</div>
        </div>
    );
}
