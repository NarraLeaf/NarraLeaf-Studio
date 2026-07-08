import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/**
 * Chrome for a project sub-page: a back header (title + optional description)
 * over a scrollable content area. The slide-in transition is owned by the
 * parent panel; this component only provides the static layout.
 */
export function ProjectSubPage({
    title,
    description,
    onBack,
    children,
}: {
    title: string;
    description?: string;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-[#101114] text-fg">
            <div className="flex items-center gap-2 border-b border-edge p-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    aria-label="Back to project overview"
                    title="Back"
                >
                    <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fg">{title}</div>
                    {description ? (
                        <div className="truncate text-2xs text-fg-subtle">{description}</div>
                    ) : null}
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </div>
    );
}
