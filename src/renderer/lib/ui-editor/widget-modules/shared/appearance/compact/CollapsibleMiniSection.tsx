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
        <div className="rounded-lg border border-edge bg-fill-subtle overflow-hidden min-w-0">
            <button
                type="button"
                onClick={toggle}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-fill-subtle transition"
            >
                <span className="text-fg-subtle shrink-0">
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
                <span
                    className={`text-2xs font-medium tracking-wide ${
                        subtle ? "text-fg-subtle" : "text-fg-muted"
                    }`}
                >
                    {title}
                </span>
            </button>
            {!collapsed && <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-edge-subtle">{children}</div>}
        </div>
    );
}
