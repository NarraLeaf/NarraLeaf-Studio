import React from "react";
import { cn } from "../../utils/cn";

export interface TabItem {
    id: string;
    label: React.ReactNode;
    /** Optional trailing element, e.g. a count Badge. */
    badge?: React.ReactNode;
    disabled?: boolean;
}

export interface TabStripProps {
    tabs: TabItem[];
    activeId: string;
    onChange: (id: string) => void;
    size?: "sm" | "md";
    className?: string;
}

/**
 * Horizontal tab strip with an active underline. Canonicalizes the 4 separate
 * `role="tab"` + underline reimplementations (story rows, console, blueprint
 * debug, editor group) into one component.
 */
export function TabStrip({ tabs, activeId, onChange, size = "md", className }: TabStripProps) {
    return (
        <div role="tablist" className={cn("flex items-stretch border-b border-edge", className)}>
            {tabs.map((tab) => {
                const active = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        disabled={tab.disabled}
                        onClick={() => onChange(tab.id)}
                        className={cn(
                            "relative inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-default",
                            "focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
                            size === "sm" ? "px-2.5 py-1.5 text-2xs" : "px-3 py-2 text-sm",
                            active ? "text-fg" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                        )}
                    >
                        {tab.label}
                        {tab.badge}
                        {active && (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
