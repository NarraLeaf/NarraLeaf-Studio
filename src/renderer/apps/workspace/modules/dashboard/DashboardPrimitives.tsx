import React from "react";

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
