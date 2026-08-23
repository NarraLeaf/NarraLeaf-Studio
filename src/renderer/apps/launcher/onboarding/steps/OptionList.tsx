import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A short list of mutually exclusive answers, as rows rather than as a dropdown.
 *
 * Setup asks about things whose options are few and worth reading side by side - three languages,
 * three themes, three ways to tint a row - and a dropdown hides two of every three answers behind a
 * click. Where the list is genuinely long (the zoom ladder, the installed fonts) these screens use
 * the shared `Select` and the font picker instead, which is the same rule the settings window
 * follows.
 *
 * `<button>` rather than `<input type=radio>`: the row is the target, and the radio's own dot would
 * be a second thing saying what the accent border already says. The roles are written out so a
 * screen reader still reads it as the group of choices it is.
 */

export interface OptionItem {
    value: string;
    label: string;
    /** One short line under the label - what this answer means, never a second sentence. */
    hint?: ReactNode;
    icon?: ComponentType<{ className?: string }>;
}

export interface OptionListProps {
    label: string;
    value: string;
    options: readonly OptionItem[];
    onChange: (value: string) => void;
}

export function OptionList({ label, value, options, onChange }: OptionListProps) {
    return (
        <div role="radiogroup" aria-label={label} className="space-y-1.5">
            {options.map(option => {
                const selected = option.value === value;
                const Icon = option.icon;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(option.value)}
                        className={cn(
                            "nl-focus-ring flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-colors duration-150",
                            selected ? "border-primary bg-primary/15 text-fg" : "border-edge text-fg-muted hover:bg-fill",
                        )}
                    >
                        {Icon ? <Icon className={cn("h-4 w-4 shrink-0", selected ? "text-primary" : "text-fg-subtle")} /> : null}
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{option.label}</span>
                            {option.hint ? <span className="mt-0.5 block truncate text-xs text-fg-subtle">{option.hint}</span> : null}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
