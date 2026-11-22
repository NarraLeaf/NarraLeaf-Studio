import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";
import { NESTED_SECTION_CLASS, textLevelClass, type TextDensity } from "./textLevels";

export interface SectionTitleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    /** `panel` for side panels and the inspector, `page` for dialogs and the settings window. */
    density?: TextDensity;
    /** The element the title text renders as. A section heading is an `h3` unless the page says otherwise. */
    as?: "h2" | "h3" | "h4" | "div";
    /** Trailing controls: a count, a help `?`, an add button. Clicks on them do not fold the section. */
    actions?: React.ReactNode;
    /**
     * When given, the section folds: a chevron leads the row and the whole row toggles. `false` is
     * expanded, `true` collapsed.
     */
    collapsed?: boolean;
    onToggle?: () => void;
    /** A section inside another section: drawn one size down (see `NESTED_SECTION_CLASS`). */
    nested?: boolean;
    children: React.ReactNode;
}

/**
 * The heading of a group of fields or settings: the `section` level of docs/design-system.md §4.1.
 *
 * It draws no box and no fill. What sets a section apart from the fields under it is the weight and
 * the colour of its text, and the divider or the space above it, which the caller's layout provides
 * (`SectionField` draws the divider; a settings page leaves the space).
 */
export function SectionTitle({
    density = "panel",
    as: Tag = "h3",
    actions,
    collapsed,
    onToggle,
    nested = false,
    className,
    children,
    ...props
}: SectionTitleProps) {
    const collapsible = onToggle !== undefined;
    const title = <Tag className={cn("m-0 min-w-0 truncate", nested ? NESTED_SECTION_CLASS[density] : textLevelClass("section", density))}>{children}</Tag>;
    return (
        <div className={cn("flex min-w-0 items-center gap-1.5", className)} {...props}>
            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={!collapsed}
                    data-section-toggle=""
                    onClick={onToggle}
                    className="-ml-1 flex min-w-0 flex-1 items-center gap-1 rounded-md py-0.5 pl-1 text-left hover:bg-fill-subtle focus-visible:!outline focus-visible:!outline-1 focus-visible:!outline-primary/60"
                >
                    <ChevronRight
                        aria-hidden="true"
                        // The turn is the standalone `rotate` property, as in `Accordion`: a `rotate-90` transform
                        // utility collides with the transform table the engine injects (see styles.css).
                        className="h-3.5 w-3.5 shrink-0 text-fg-subtle transition-[rotate] duration-150"
                        style={{ rotate: collapsed ? "0deg" : "90deg" }}
                    />
                    {title}
                </button>
            ) : (
                <div className="min-w-0 flex-1">{title}</div>
            )}
            {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
    );
}
