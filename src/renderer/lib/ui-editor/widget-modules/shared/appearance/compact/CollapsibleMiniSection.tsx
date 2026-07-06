import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
    title: string;
    defaultCollapsed?: boolean;
    /** When true, header shows muted style (empty state hint). */
    subtle?: boolean;
    children: React.ReactNode;
};

/**
 * Lightweight collapsible block for compact appearance panels (matches property section affordance).
 */
export function CollapsibleMiniSection({ title, defaultCollapsed = true, subtle, children }: Props) {
    const [collapsed, setCollapsed] = useState(defaultCollapsed);
    const toggle = useCallback(() => setCollapsed(c => !c), []);

    return (
        <div className="rounded-lg border border-white/10 bg-black/15 overflow-hidden min-w-0">
            <button
                type="button"
                onClick={toggle}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-white/[0.04] transition"
            >
                <span className="text-gray-500 shrink-0">
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
                <span
                    className={`text-[11px] font-medium tracking-wide ${
                        subtle ? "text-gray-500" : "text-gray-400"
                    }`}
                >
                    {title}
                </span>
            </button>
            {!collapsed && <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-white/5">{children}</div>}
        </div>
    );
}
