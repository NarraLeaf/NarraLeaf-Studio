import type { ReactNode } from "react";

type Props = {
    title: string;
    /** Optional header actions (state chips + add-state menu). */
    headerRight?: ReactNode;
    /** Secondary action only meant to appear when the card header is hovered/focused. */
    headerHoverAction?: ReactNode;
    children: ReactNode;
};

/**
 * Visual wrapper aligned with image Border/Fill inspector modules.
 */
export function CompactModuleCard({ title, headerRight, headerHoverAction, children }: Props) {
    return (
        <div className="group rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-2 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 shrink">
                    <div className="text-xs font-medium text-gray-200 shrink-0 pt-0.5">{title}</div>
                    {headerHoverAction ? (
                        <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            {headerHoverAction}
                        </div>
                    ) : null}
                </div>
                {headerRight ? <div className="min-w-0 flex-1 flex justify-end">{headerRight}</div> : null}
            </div>
            {children}
        </div>
    );
}
