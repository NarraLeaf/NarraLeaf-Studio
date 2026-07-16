import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

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
    const { t } = useTranslation();
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

    const leftPanelClasses = `absolute inset-y-0 left-0 z-10 flex w-56 shrink-0 flex-col border-r border-edge bg-surface-sunken transition-transform duration-200 ease-out ${
        isLeftCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-sm text-fg">
            <header className="flex shrink-0 items-center border-b border-edge px-3 py-2">
                <div className="min-w-0 flex-1">{header}</div>
            </header>
            <div className="relative flex min-h-0 min-w-0 flex-1">
                <aside className={leftPanelClasses}>
                    <div className="flex shrink-0 items-center justify-between border-b border-edge px-2 py-1.5">
                        <span className="text-2xs font-medium text-fg-subtle">{t("blueprint.panelLabel")}</span>
                        <button
                            type="button"
                            className="text-fg-muted transition-colors hover:text-fg"
                            onClick={() => setLeftCollapsed(!isLeftCollapsed)}
                            title={isLeftCollapsed ? t("blueprint.sidePanel.expand") : t("blueprint.sidePanel.collapse")}
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
                        className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-edge-strong bg-surface-canvas/85 text-fg-muted hover:text-fg focus:outline-none"
                        onClick={() => setLeftCollapsed(false)}
                        title={t("blueprint.sidePanel.expand")}
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                ) : null}
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">{canvas}</main>
            </div>
            {diagnostics}
        </div>
    );
}
