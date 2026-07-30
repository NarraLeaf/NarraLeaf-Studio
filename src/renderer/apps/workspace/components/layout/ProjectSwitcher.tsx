import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, FolderOpen, History, Loader2, Plus, RotateCcw } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { useWorkspace } from "../../context";
import { useOpenRecentProject, useRecentProjects } from "../../hooks/useRecentProjects";
import type { VersionSurface } from "../../hooks/useVersionSurface";
import { focusedRevision, isVersionSurfaceVisible, shortRevision, versionFace } from "./versionRailModel";
import { openVersionRail } from "./versionRailController";

/**
 * PyCharm-style project switcher for the title bar: the current project's name with a dropdown of
 * recent workspaces to jump between. Selecting one focuses its window if already open, otherwise
 * opens it in a new window — the current project is never closed out from under the user.
 *
 * That last part is the whole contract, and it is why none of these actions asks to reuse this
 * window. One project, one window (the JetBrains model the rest of the shell follows): going to
 * another project is not a request to close the one you are in, and a switcher that retires the
 * window behind it destroys unsaved context for a gesture the user reads as navigation. Closing a
 * project is its own explicit action, with its own confirmation.
 *
 * Lives at the left of the title bar (before the action bar), so it reads as the window's identity
 * the way an IDE's project name does — and version control lives INSIDE its menu (see
 * {@link VersionSection}) rather than as a second control beside it, because the top bar was naming
 * the version twice: once there and once in the status bar, which shows it permanently.
 */
export function ProjectSwitcher({ versionSurface }: { versionSurface: VersionSurface }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const recentProjects = useRecentProjects();
    const openRecentProject = useOpenRecentProject();

    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const currentPath = context?.project.getConfig().projectPath ?? "";
    const currentName = context
        ? context.services.get<ProjectService>(Services.Project).getProjectConfig().name
        : "";
    const displayName = currentName?.trim() || t("workspace.shell.projectSwitcher.untitled");

    // The current project is already in the history; the switcher is for jumping elsewhere, so
    // drop it from the list rather than offering a no-op "switch to what you're in".
    const others = recentProjects.filter(project => !isSamePath(project.path, currentPath));

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

    const close = useCallback(() => setOpen(false), []);

    const handleSwitch = useCallback((projectPath: string) => {
        setOpen(false);
        // Focuses the project's window when it already has one; opens one alongside otherwise.
        void openRecentProject(projectPath);
    }, [openRecentProject]);

    const handleOpenFolder = useCallback(() => {
        setOpen(false);
        void (async () => {
            const result = await getInterface().selectFolder();
            if (result.success && result.data?.path) {
                await getInterface().workspace.launch({ projectPath: result.data.path });
            }
        })();
    }, []);

    const handleNewProject = useCallback(() => {
        setOpen(false);
        void (async () => {
            const result = await getInterface().app.launchProjectWizard({});
            if (result.success && result.data?.created) {
                await getInterface().workspace.launch({ projectPath: result.data.projectPath });
            }
        })();
    }, []);

    return (
        <div className="relative" ref={containerRef}>
            {/* The face names the PROJECT and nothing else. The version deliberately does not appear
                here: the status bar already shows it permanently and tints it while a past revision is
                on screen, and the point of folding the old top-bar widget into this menu was to stop
                the window from saying the same thing in two places. */}
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                className={cn(
                    "h-8 max-w-56 px-2 rounded-md flex items-center gap-1.5 text-sm cursor-default transition-colors",
                    open ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
                title={t("workspace.shell.projectSwitcher.switchProject")}
                aria-label={t("workspace.shell.projectSwitcher.switchProject")}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span className="truncate">{displayName}</span>
                <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-180")} />
            </button>

            {open && (
                <div
                    className="absolute top-full left-0 mt-1 z-20 w-80 max-w-[80vw] bg-surface-overlay border border-edge-strong rounded-md shadow-lg py-1"
                    role="menu"
                    aria-label={t("workspace.shell.projectSwitcher.switchProject")}
                >
                    <div className="px-3 pt-1.5 pb-1 text-2xs tracking-wide text-fg-subtle">
                        {t("workspace.shell.projectSwitcher.recentProjects")}
                    </div>

                    {others.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-fg-subtle">
                            {t("workspace.shell.projectSwitcher.noRecent")}
                        </div>
                    ) : (
                        <div className="max-h-80 overflow-y-auto">
                            {others.map(project => (
                                <RecentProjectRow
                                    key={project.path}
                                    project={project}
                                    onSelect={() => handleSwitch(project.path)}
                                />
                            ))}
                        </div>
                    )}

                    <VersionSection surface={versionSurface} onAct={close} />

                    <MenuSeparator />

                    <SwitcherAction icon={<FolderOpen className="w-4 h-4" />} label={t("workspace.shell.projectSwitcher.openProject")} onClick={handleOpenFolder} />
                    <SwitcherAction icon={<Plus className="w-4 h-4" />} label={t("workspace.shell.projectSwitcher.newProject")} onClick={handleNewProject} />
                </div>
            )}
        </div>
    );
}

/**
 * The version-control section of the switcher's menu: which version this window is a view of, and the
 * two or three things that can be offered without reading the repository.
 *
 * **It shows an identity, never a change count.** A count would need a status scan, a scan is not a
 * pure read — it records newly discovered directories into the repository's staged state, so a menu
 * that kept its number fresh would report deletions the author never made (docs/version-control.md
 * §4.17) — and a number that only updated when something else happened to refresh it would be worse
 * than none. So: which version, plus the actions. Anything more — the change list, the history, the
 * commit form — opens the rail, which is the surface that owns them.
 *
 * **On a host with no version control the whole section does not exist.** Not a disabled row: version
 * control is an optional capability with no native build for macOS Intel or Windows ARM64, so on those
 * machines it was never shipped, and a greyed entry with a tooltip tells an author their install is
 * broken when nothing is. The judgement is `isVersionSurfaceVisible`, shared with the rail and the
 * status cell. The separator ABOVE the section is drawn here rather than by the caller for that same
 * reason — a gate in one place cannot leave a separator stranded against another.
 *
 * The line it shows comes from `versionFace`, shared with the status-bar cell and the rail, so the
 * three cannot name one version three ways. It carries its own identity now because the top bar no
 * longer shows one: the menu has to say which version this is before it offers to leave it.
 */
function VersionSection({ surface, onAct }: { surface: VersionSurface; onAct: () => void }) {
    const { t } = useTranslation();
    const { state, busy } = surface;

    if (!isVersionSurfaceVisible(state)) {
        return null;
    }

    const onRevision = state.kind === "revision";
    const face = versionFace({ state, branch: surface.branch }, t);
    // The head, or the revision being previewed — null in the two states that name no revision at all.
    const revision = focusedRevision(state);
    const run = (action: () => void) => () => {
        onAct();
        action();
    };

    return (
        <>
            <MenuSeparator />

            <div className="px-3 pt-1.5 pb-1 text-2xs tracking-wide text-fg-subtle">
                {t("workspace.shell.versionControl.title")}
            </div>

            <div
                className="flex items-baseline gap-2 px-3 pb-1.5"
                // The UNCUT line: a branch name too long for the face still belongs somewhere.
                title={onRevision
                    ? t("workspace.shell.versionControl.viewingVersion", { version: face.full })
                    : face.full !== face.text ? face.full : undefined}
            >
                {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-fg-subtle" />}
                <span className={cn("truncate text-sm tabular-nums", onRevision ? "text-primary" : "text-fg")}>
                    {face.text}
                </span>
                {/* The hash is the only thing that distinguishes two revisions carrying the same label. */}
                {revision && (
                    <span className="shrink-0 font-mono text-2xs text-fg-subtle">{shortRevision(revision)}</span>
                )}
            </div>

            {onRevision && (
                <SwitcherAction
                    icon={<RotateCcw className="w-4 h-4" />}
                    label={t("workspace.shell.versionControl.returnToCurrent")}
                    onClick={run(surface.returnToCurrent)}
                />
            )}

            {state.kind === "not-a-repository" && (
                <SwitcherAction
                    icon={<Plus className="w-4 h-4" />}
                    label={t("workspace.shell.versionControl.enable")}
                    onClick={run(surface.enableVersionControl)}
                />
            )}

            {/* Everything that needs a scan or the history lives in the rail. */}
            <SwitcherAction
                icon={<History className="w-4 h-4" />}
                label={t("workspace.shell.versionControl.open")}
                onClick={run(openVersionRail)}
            />
        </>
    );
}

function MenuSeparator() {
    return <div className="h-px bg-fill-strong my-1 mx-2" />;
}

function RecentProjectRow({ project, onSelect }: { project: RecentlyOpenedProject; onSelect: () => void }) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className="w-full px-3 py-2 flex items-center gap-3 text-left cursor-default text-fg-muted hover:bg-fill hover:text-fg transition-colors"
            role="menuitem"
            title={`${project.name}\n${project.path}`}
        >
            <span className="shrink-0 w-7 h-7 rounded-md bg-fill grid place-items-center overflow-hidden">
                {project.icon ? (
                    <img src={project.icon} alt="" className="w-5 h-5 object-contain" />
                ) : (
                    <FolderOpen className="w-4 h-4 text-fg-subtle" />
                )}
            </span>
            <span className="flex-1 min-w-0">
                <span className="block text-sm text-fg truncate">{project.name}</span>
                <span className="block text-2xs text-fg-subtle truncate">{project.path}</span>
            </span>
        </button>
    );
}

function SwitcherAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full px-3 py-2 flex items-center gap-2 text-left text-sm cursor-default text-fg-muted hover:bg-fill hover:text-fg transition-colors"
            role="menuitem"
        >
            <span className="w-4 h-4 shrink-0 text-fg-subtle">{icon}</span>
            <span className="truncate">{label}</span>
        </button>
    );
}

function isSamePath(a: string, b: string): boolean {
    return a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");
}
