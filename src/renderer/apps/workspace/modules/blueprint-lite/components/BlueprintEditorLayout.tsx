import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { HelpTrigger } from "@/lib/help";
import { DetachedTitleBarControls, useDetachedTitleBar } from "@/lib/components/layout";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";

type Props = {
    header: ReactNode;
    /** Controls at the far right of the title row, after the help trigger. */
    headerActions?: ReactNode;
    /** Non-primary clicks on the title row - a middle click there pops the editor out. */
    onHeaderAuxClick?: (event: ReactMouseEvent) => void;
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
    headerActions,
    onHeaderAuxClick,
    memberTree,
    canvas,
    diagnostics,
    memberPanelCollapsed,
    onMemberPanelCollapsedChange,
    onMemberPanelFocusContainedChange,
}: Props) {
    const { t } = useTranslation();
    const detachedTitleBar = useDetachedTitleBar();
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
        // The whole editor answers with one topic: `F1` anywhere in it - the canvas, the member
        // tree, the diagnostics list - is the same question about the same thing.
        <div className="flex h-full min-h-0 flex-col bg-surface text-sm text-fg" data-help-topic="blueprints">
            {/* Detached, this row IS the window's title bar: the window is frameless like every
                other Studio window, so the row carries the drag region, the gap the macOS traffic
                lights are drawn into, and (off macOS) the window buttons. Everything in it that
                takes a click has to say `no-drag`, or the drag region swallows the click. */}
            <header
                className={cn(
                    "group/help flex shrink-0 items-center gap-1 border-b border-edge px-3",
                    detachedTitleBar.isDetached ? "h-10 min-h-10 py-0 pr-0" : "py-2",
                    detachedTitleBar.rowProps.className,
                )}
                style={detachedTitleBar.rowProps.style}
                onAuxClick={onHeaderAuxClick}
            >
                <div className="min-w-0 flex-1">{header}</div>
                {/* No help in a detached window: F1 opens the help panel, which is a dock panel of
                    the workspace window, so the answer would appear in the window the author is not
                    looking at. The editor is one F1 away in the workspace either way. */}
                {detachedTitleBar.isDetached ? null : <HelpTrigger topic="blueprints" />}
                {headerActions ? <div className="no-drag flex items-center">{headerActions}</div> : null}
                <DetachedTitleBarControls />
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
