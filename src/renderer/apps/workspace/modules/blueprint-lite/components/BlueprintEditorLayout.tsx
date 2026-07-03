import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type Props = {
    header: ReactNode;
    memberTree: ReactNode;
    canvas: ReactNode;
    diagnostics: ReactNode;
    memberPanelCollapsed?: boolean;
    onMemberPanelCollapsedChange?: (collapsed: boolean) => void;
    /** True while focus is inside the left member panel (disables graph delete-key shortcuts). */
    onMemberPanelFocusContainedChange?: (contained: boolean) => void;
};

export function BlueprintEditorLayout({
    header,
    memberTree,
    canvas,
    diagnostics,
    memberPanelCollapsed,
    onMemberPanelCollapsedChange,
    onMemberPanelFocusContainedChange,
}: Props) {
    const [uncontrolledLeftCollapsed, setUncontrolledLeftCollapsed] = useState(false);
    const memberPanelScrollRef = useRef<HTMLDivElement>(null);
    const isLeftCollapsed = memberPanelCollapsed ?? uncontrolledLeftCollapsed;

    const setLeftCollapsed = (collapsed: boolean) => {
        if (memberPanelCollapsed === undefined) {
            setUncontrolledLeftCollapsed(collapsed);
        }
        onMemberPanelCollapsedChange?.(collapsed);
    };

    useLayoutEffect(() => {
        const root = memberPanelScrollRef.current;
        const notify = onMemberPanelFocusContainedChange;
        if (!root || !notify) {
            return;
        }
        const onFocusIn = () => {
            notify(true);
        };
        const onFocusOut = (e: FocusEvent) => {
            const next = e.relatedTarget as Node | null;
            if (!root.contains(next)) {
                notify(false);
            }
        };
        root.addEventListener("focusin", onFocusIn);
        root.addEventListener("focusout", onFocusOut);
        return () => {
            root.removeEventListener("focusin", onFocusIn);
            root.removeEventListener("focusout", onFocusOut);
        };
    }, [onMemberPanelFocusContainedChange]);

    const leftPanelClasses = `absolute inset-y-0 left-0 z-10 flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0b0d12] transition-transform duration-200 ease-out ${
        isLeftCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0f1115] text-sm text-gray-200">
            <header className="flex shrink-0 items-center border-b border-white/10 px-3 py-2">
                <div className="min-w-0 flex-1">{header}</div>
            </header>
            <div className="relative flex min-h-0 min-w-0 flex-1">
                <aside className={leftPanelClasses}>
                    <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-2 py-1.5">
                        <span className="text-[11px] font-medium text-gray-500">Blueprint</span>
                        <button
                            type="button"
                            className="text-gray-400 transition-colors hover:text-white"
                            onClick={() => setLeftCollapsed(!isLeftCollapsed)}
                            title={isLeftCollapsed ? "Expand side panel" : "Collapse side panel"}
                        >
                            {isLeftCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        </button>
                    </div>
                    <div ref={memberPanelScrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
                        {memberTree}
                    </div>
                </aside>
                {isLeftCollapsed ? (
                    <button
                        type="button"
                        className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#05060a]/85 text-gray-300 hover:text-white focus:outline-none"
                        onClick={() => setLeftCollapsed(false)}
                        title="Expand side panel"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                ) : null}
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0f1115]">{canvas}</main>
            </div>
            {diagnostics}
        </div>
    );
}
