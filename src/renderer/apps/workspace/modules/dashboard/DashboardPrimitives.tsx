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
                    <h2 className="text-sm font-semibold text-fg">{title}</h2>
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

/**
 * A block of `label → number` rows in one card.
 *
 * The dashboard used to give every single integer a box of its own — eight of them for Scale, four
 * more for the writing week — and the boxes filled the first screen with nothing but counts. Worse,
 * a ~130px box could not hold its own caption: "Interface surfaces" and "No streak" were both
 * printing with an ellipsis. A row gives the label the width of the card, so nothing truncates, and
 * the same figures now cost a third of the height.
 *
 * `columns` is a maximum: the grid falls back to one column in a narrow editor pane.
 */
export function StatList({ children, columns = 2 }: { children: React.ReactNode; columns?: 1 | 2 }) {
    return (
        <dl
            className={[
                // Columns are capped at 15rem: a value sits within reach of its label instead of at the
                // far edge of a card as wide as the pane, and the card is only as wide as its rows.
                "grid w-fit max-w-full grid-cols-[minmax(0,15rem)] gap-x-12 rounded-md border border-edge bg-fill-subtle px-3 py-2",
                columns === 2 ? "sm:grid-cols-[repeat(2,15rem)]" : "",
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {children}
        </dl>
    );
}

/** One `label → value` line. The label wraps rather than truncating; the value never wraps. */
export function StatRow({ label, value, hint, empty }: { label: string; value: string; hint?: string; empty?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="min-w-0 text-xs text-fg-muted">{label}</dt>
            {/* A value that says there is nothing ("No streak") reads quieter than a figure, never louder. */}
            <dd className={empty ? "shrink-0 text-xs tabular-nums text-fg-subtle" : "shrink-0 text-sm font-medium tabular-nums text-fg"}>
                {value}
                {hint && <span className="ml-1.5 text-2xs font-normal text-fg-subtle">{hint}</span>}
            </dd>
        </div>
    );
}
