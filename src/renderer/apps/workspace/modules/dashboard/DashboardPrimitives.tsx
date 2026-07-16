import React from "react";
import { cn } from "@/lib/utils/cn";

export function DashboardSection({
    title,
    description,
    actions,
    children,
}: {
    title: string;
    description?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="flex flex-col gap-3">
            <header className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-3">
                    <h2 className="text-sm font-medium text-fg">{title}</h2>
                    {description && <p className="text-2xs text-fg-subtle">{description}</p>}
                </div>
                {actions}
            </header>
            {children}
        </section>
    );
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-edge bg-fill-subtle px-3 py-2.5">
            <span className="truncate text-2xs text-fg-subtle">{label}</span>
            <span className="truncate text-lg font-medium tabular-nums text-fg">{value}</span>
            {hint && <span className="truncate text-2xs text-fg-subtle">{hint}</span>}
        </div>
    );
}

export type BarListItem = {
    id: string;
    /** Always a human name — never an internal id. */
    name: string;
    value: number;
    detail: string;
};

export function BarList({ items, emptyLabel }: { items: readonly BarListItem[]; emptyLabel: string }) {
    if (items.length === 0) {
        return <p className="text-xs text-fg-subtle">{emptyLabel}</p>;
    }
    const peak = Math.max(...items.map(item => item.value), 1);

    return (
        <ul className="flex flex-col gap-2.5">
            {items.map(item => (
                <li key={item.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-xs text-fg-muted">{item.name}</span>
                        <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{item.detail}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-fill">
                        <div
                            className="h-full rounded-full bg-primary/60"
                            style={{ width: `${(Math.max(0, item.value) / peak) * 100}%` }}
                        />
                    </div>
                </li>
            ))}
        </ul>
    );
}

/** Scene/character name chips. Wraps rather than scrolls, so a long list can't widen the tab. */
export function NameChips({ names, className }: { names: readonly string[]; className?: string }) {
    return (
        <div className={cn("flex flex-wrap gap-1.5", className)}>
            {names.map((name, index) => (
                <span
                    key={`${name}-${index}`}
                    className="max-w-[16rem] truncate rounded border border-edge bg-fill-subtle px-1.5 py-0.5 text-2xs text-fg-muted"
                    title={name}
                >
                    {name}
                </span>
            ))}
        </div>
    );
}
