import type { ReactNode } from "react";

type Props = {
    title: string;
    /** Optional header actions (state chips + add-state menu). */
    headerRight?: ReactNode;
    children: ReactNode;
};

/**
 * Visual wrapper aligned with image Stroke/Fill inspector modules.
 */
export function CompactModuleCard({ title, headerRight, children }: Props) {
    return (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-2 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="text-xs font-medium text-gray-200 shrink-0 pt-0.5">{title}</div>
                {headerRight ? <div className="min-w-0 flex-1 flex justify-end">{headerRight}</div> : null}
            </div>
            {children}
        </div>
    );
}
