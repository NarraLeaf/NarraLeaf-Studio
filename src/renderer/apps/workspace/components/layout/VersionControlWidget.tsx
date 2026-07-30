import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, GitBranch, History, Loader2, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import type { VersionSurface } from "../../hooks/useVersionSurface";
import { isVersionSurfaceVisible, revisionLabel, shortRevision } from "./versionRailModel";
import { openVersionRail } from "./versionRailController";

/**
 * The title-bar version control widget, immediately right of the project switcher.
 *
 * It shows the version this window is a view of, and **it shows an identity, never a change count.**
 * A count would need a status scan, a scan is not a pure read - it records newly discovered
 * directories into the repository's staged state, so a widget that kept its number fresh would report
 * deletions the author never made (docs/version-control.md §4.17) - and a number that only updated
 * when something else happened to refresh it would be worse than none. So: which version, plus a menu.
 *
 * The menu offers only what can be answered without scanning. Anything more - the change list, the
 * history, the commit form - opens the rail, which is the surface that owns them.
 *
 * On a host with no version control this renders nothing at all. Not a disabled button: version
 * control is an optional capability with no native build for macOS Intel or Windows ARM64, so on those
 * machines it was never shipped, and a greyed control with a tooltip tells an author their install is
 * broken when nothing is.
 */
export function VersionControlWidget({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const { state, busy } = surface;
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
            }
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    if (!isVersionSurfaceVisible(state)) {
        return null;
    }

    const onRevision = state.kind === "revision";
    const run = (action: () => void) => () => {
        setOpen(false);
        action();
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                title={onRevision
                    ? t("workspace.shell.versionControl.viewingVersion", { version: faceLabel(state, t) })
                    : t("workspace.shell.versionControl.title")}
                aria-label={t("workspace.shell.versionControl.title")}
                aria-haspopup="menu"
                aria-expanded={open}
                className={cn(
                    "flex h-8 max-w-44 items-center gap-1.5 rounded-md px-2 text-sm transition-colors cursor-default",
                    onRevision
                        ? "bg-primary/15 text-primary hover:bg-primary/25"
                        : open ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {busy
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <GitBranch className="h-4 w-4" />}
                </span>
                <span className="truncate tabular-nums">{faceLabel(state, t)}</span>
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label={t("workspace.shell.versionControl.title")}
                    className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-edge-strong bg-surface-overlay py-1 shadow-lg"
                >
                    {/* The identity, spelled out: the face is narrow enough to truncate, and the hash is
                        the only thing that distinguishes two revisions with the same label. */}
                    {(state.kind === "current" || state.kind === "revision") && (
                        <div className="px-3 pb-1 pt-1.5 text-2xs text-fg-subtle">
                            <span className="font-mono">
                                {shortRevision(state.kind === "current" ? state.head : state.revision)}
                            </span>
                        </div>
                    )}

                    {onRevision && (
                        <WidgetRow
                            icon={<RotateCcw className="h-4 w-4" />}
                            label={t("workspace.shell.versionControl.returnToCurrent")}
                            onClick={run(surface.returnToCurrent)}
                        />
                    )}

                    {state.kind === "not-a-repository" && (
                        <WidgetRow
                            icon={<Plus className="h-4 w-4" />}
                            label={t("workspace.shell.versionControl.enable")}
                            onClick={run(surface.enableVersionControl)}
                        />
                    )}

                    {/* Everything that needs a scan or the history lives in the rail. */}
                    <WidgetRow
                        icon={<History className="h-4 w-4" />}
                        label={t("workspace.shell.versionControl.open")}
                        onClick={run(openVersionRail)}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * The one line the widget has room for.
 *
 * `#4` wherever a revision number is known, because that is the only short thing about a revision
 * that means anything to the person reading it; the short hash is the fallback for a revision view
 * entered without a label, and the two prose answers cover the states where there is no version yet.
 */
function faceLabel(state: VersionSurface["state"], t: Translator["t"]): string {
    switch (state.kind) {
        case "revision":
            return state.label ?? shortRevision(state.revision);
        case "current":
            return state.number !== null ? revisionLabel(state.number) : shortRevision(state.head);
        case "not-a-repository":
            return t("workspace.shell.versionControl.notVersioned");
        case "empty":
            return t("workspace.shell.versionControl.noHistory");
        default:
            // Probing. An em dash rather than a word: it is one round trip long, and a label that
            // said "checking…" would flash on every project open.
            return "—";
    }
}

function WidgetRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg"
        >
            <span className="h-4 w-4 shrink-0 text-fg-subtle">{icon}</span>
            <span className="truncate">{label}</span>
        </button>
    );
}
