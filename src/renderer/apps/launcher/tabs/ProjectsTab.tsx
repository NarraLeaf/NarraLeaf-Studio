
import { getInterface } from "@/lib/app/bridge";
import { RecentProjectMissingReason, RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { ContextMenu, IconButton, Input, Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import type { ContextMenuDef } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, FolderOpen, MoreVertical, Plus, Search, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { collapseHomePath, normalizeProjectPath } from "@shared/utils/recentProject";
import { useHomeDir } from "@/lib/app/hooks/useHomeDir";
import { useMissingRecentProjects, useRecentProjects, useRemoveRecentProject } from "@/lib/app/hooks/useRecentProjects";
import { createProjectFromWizard, openProjectFromFolder, relocateRecentProject } from "../projectActions";
import { projectAvatarColor, projectInitials } from "../projectAvatar";

export function ProjectsTab() {
    const { t } = useTranslation();
    const [isOpening, setIsOpening] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [operationError, setOperationError] = useState<string | null>(null);
    // Live, so a project opened or removed from another window shows up here too.
    const recentProjects = useRecentProjects();
    const removeRecentProject = useRemoveRecentProject();
    // Checked once, on the way into the app - see useMissingRecentProjects.
    const missingByPath = useMissingRecentProjects();
    // The entry whose "cannot find this" dialog is open, if any.
    const [missingTarget, setMissingTarget] = useState<RecentlyOpenedProject | null>(null);
    const [missingError, setMissingError] = useState<string | null>(null);
    const [isRelocating, setIsRelocating] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    // The row whose overflow menu is open, with the screen point to anchor it to.
    const [rowMenu, setRowMenu] = useState<{ project: RecentlyOpenedProject; x: number; y: number } | null>(null);
    const homeDir = useHomeDir();
    const isBusy = isOpening || isImporting;

    // Plain case-insensitive substring, over name *and* path. Matching the path is what makes this
    // worth having: several projects can share a name ("Demo", "test"), and where they live is
    // often the only thing that tells them apart. No fuzzy matching, in line with global search -
    // over a list this short it mostly produces surprising hits rather than helpful ones.
    const visibleProjects = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return recentProjects;
        return recentProjects.filter(project =>
            project.name.toLowerCase().includes(query)
            || project.path.toLowerCase().includes(query),
        );
    }, [recentProjects, searchQuery]);

    const handleOpenRecentProject = async (project: RecentlyOpenedProject) => {
        if (isBusy) return;

        // Known to be gone: ask what to do with the entry instead of opening a workspace that can
        // only land on an error screen.
        if (missingByPath.has(normalizeProjectPath(project.path))) {
            setMissingError(null);
            setMissingTarget(project);
            return;
        }

        setIsOpening(true);
        setOperationError(null);
        try {
            // Open workspace with the project path
            await getInterface().workspace.launch(
                { projectPath: project.path },
                true // Close launcher window after opening workspace
            );
        } catch (error) {
            console.error("Error opening recent project:", error);
            setOperationError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsOpening(false);
        }
    };

    const handleRelocateMissing = async () => {
        if (!missingTarget) return;

        setIsRelocating(true);
        setMissingError(null);
        try {
            const result = await relocateRecentProject(missingTarget);
            if (result.status === "error") {
                setMissingError(result.message);
                return;
            }
            if (result.status === "relocated") {
                setMissingTarget(null);
            }
            // Cancelled at the folder picker: leave the dialog up, the question still stands.
        } finally {
            setIsRelocating(false);
        }
    };

    const handleRemoveMissing = async () => {
        if (!missingTarget) return;
        await removeRecentProject(missingTarget.path);
        setMissingTarget(null);
    };

    const handleRemoveRecentProject = async (project: RecentlyOpenedProject) => {
        // The main process rebuilds the list and broadcasts it back, which is what re-renders this
        // one. No optimistic local copy: writing a filtered snapshot back would erase whatever
        // another window did to the history in the meantime.
        await removeRecentProject(project.path);
    };

    /**
     * The row's overflow menu. Everything here is also reachable another way (a row opens on
     * click, a missing row offers the same two actions in its dialog) - this is the discoverable
     * home for them, not the only one.
     */
    const rowMenuItems = (project: RecentlyOpenedProject): ContextMenuDef => {
        const isMissing = missingByPath.has(normalizeProjectPath(project.path));
        return [
            {
                id: "open",
                label: t("launcher.projects.openProject"),
                onClick: () => void handleOpenRecentProject(project),
            },
            ...(isMissing ? [{
                id: "relocate",
                label: t("launcher.projects.missing.relocate"),
                onClick: () => {
                    setMissingError(null);
                    setMissingTarget(project);
                },
            }] : []),
            { id: "sep", separator: true as const },
            {
                id: "remove",
                label: t("launcher.projects.removeFromRecent"),
                onClick: () => void handleRemoveRecentProject(project),
            },
        ];
    };

    const handleNewProject = async () => {
        if (isBusy) return;
        setOperationError(null);
        const error = await createProjectFromWizard();
        if (error !== null) {
            setOperationError(error || t("launcher.projects.errorCreate"));
        }
    };

    const handleOpenFolder = async () => {
        if (isBusy) return;

        setIsOpening(true);
        setOperationError(null);
        try {
            const error = await openProjectFromFolder();
            if (error !== null) {
                setOperationError(error || t("launcher.projects.errorOpenFolder"));
            }
        } catch (error) {
            console.error("Error opening folder:", error);
            setOperationError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsOpening(false);
        }
    };

    const handleImportProject = async () => {
        if (isBusy) return;

        setIsImporting(true);
        setOperationError(null);
        try {
            const result = await getInterface().workspace.importProjectPackage();
            if (!result.success) {
                setOperationError(result.error || t("launcher.projects.errorImport"));
                return;
            }
            if (result.data.canceled || !result.data.projectPath) {
                return;
            }

            await getInterface().workspace.launch(
                { projectPath: result.data.projectPath },
                true
            );
        } catch (error) {
            console.error("Error importing project:", error);
            setOperationError(error instanceof Error ? error.message : String(error));
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <div className="h-full w-full flex flex-col pt-4 px-6 pb-6 text-fg">
            <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 min-w-0">
                    <Input
                        fullWidth
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        // Escape clears rather than blurs: with the field always on screen, a
                        // stale query is what hides projects, so the key that means "never
                        // mind" has to undo the filtering.
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                setSearchQuery("");
                            }
                        }}
                        placeholder={t("launcher.projects.search.placeholder")}
                        aria-label={t("launcher.projects.search.placeholder")}
                        leftIcon={<Search className="w-4 h-4" />}
                        rightIcon={searchQuery ? <X className="w-4 h-4" /> : undefined}
                        rightIconLabel={t("launcher.projects.search.clear")}
                        onRightIconClick={searchQuery ? () => setSearchQuery("") : undefined}
                        // Borderless until focused: the field spans the header, and a permanent box
                        // that wide competes with the list for attention.
                        className="bg-transparent border-transparent focus:border-edge-strong"
                    />
                </div>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenFolder}
                    disabled={isBusy}
                    title={t("launcher.projects.openFolder")}
                    aria-label={t("launcher.projects.openFolder")}
                >
                    <FolderOpen className="h-4 w-4" />
                </IconButton>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={handleImportProject}
                    disabled={isBusy}
                    title={t("launcher.projects.importProject")}
                    aria-label={t("launcher.projects.importProject")}
                >
                    <Upload className="h-4 w-4" />
                </IconButton>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={handleNewProject}
                    disabled={isBusy}
                    title={t("launcher.projects.newProject")}
                    aria-label={t("launcher.projects.newProject")}
                >
                    <Plus className="h-4 w-4" />
                </IconButton>
            </div>

            {operationError && (
                <div className="mb-3 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {operationError}
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
                {recentProjects.length === 0 && (
                    <div className="px-3 py-10 text-center text-sm text-fg-muted">
                        {t("launcher.projects.empty")}
                    </div>
                )}

                {recentProjects.length > 0 && visibleProjects.length === 0 && (
                    <div className="px-3 py-10 text-center text-sm text-fg-muted">
                        {t("launcher.projects.search.empty", { query: searchQuery.trim() })}
                    </div>
                )}

                {visibleProjects.map((project, index) => {
                    const missingEntry = missingByPath.get(normalizeProjectPath(project.path));
                    return (
                        <div key={`${project.path}-${index}`} className="relative group">
                            <button
                                type="button"
                                onClick={() => handleOpenRecentProject(project)}
                                disabled={isOpening}
                                className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 pr-11 text-left hover:bg-fill transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                                title={t("launcher.projects.openNamed", { name: project.name })}
                            >
                                {project.icon && !missingEntry ? (
                                    <img src={project.icon} alt="" className="flex-shrink-0 w-10 h-10 rounded-lg object-contain" />
                                ) : (
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
                                            "text-sm font-medium text-white/90",
                                            // A project that is not there is not a place to go, so its
                                            // tile stops advertising itself as one.
                                            missingEntry && "opacity-40 saturate-50",
                                        )}
                                        style={{ backgroundColor: projectAvatarColor(project.name) }}
                                    >
                                        {projectInitials(project.name)}
                                    </span>
                                )}
                                <span className="flex-1 min-w-0">
                                    <span className={cn("block text-sm truncate", missingEntry ? "text-fg-muted" : "text-fg")}>
                                        {project.name}
                                    </span>
                                    <span className="block text-xs text-fg-subtle truncate">
                                        {collapseHomePath(project.path, homeDir)}
                                    </span>
                                    {missingEntry && (
                                        <span className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                            <span className="truncate">{t(missingReasonKey(missingEntry.reason))}</span>
                                        </span>
                                    )}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setRowMenu({ project, x: rect.right, y: rect.bottom + 4 });
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-fg-muted opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong transition-opacity cursor-default"
                                title={t("launcher.projects.moreActions")}
                                aria-label={t("launcher.projects.moreActionsNamed", { name: project.name })}
                            >
                                <MoreVertical className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
            </div>

            {rowMenu && (
                <ContextMenu
                    items={rowMenuItems(rowMenu.project)}
                    position={{ x: rowMenu.x, y: rowMenu.y }}
                    onClose={() => setRowMenu(null)}
                />
            )}

            {missingTarget && (
                <MissingProjectDialog
                    project={missingTarget}
                    reason={missingByPath.get(normalizeProjectPath(missingTarget.path))?.reason ?? "folder-missing"}
                    error={missingError}
                    isRelocating={isRelocating}
                    onRelocate={handleRelocateMissing}
                    onRemove={handleRemoveMissing}
                    onClose={() => setMissingTarget(null)}
                />
            )}
        </div>
    );
}

function missingReasonKey(reason: RecentProjectMissingReason) {
    return reason === "folder-missing"
        ? "launcher.projects.missing.reasonFolderMissing" as const
        : "launcher.projects.missing.reasonNotAProject" as const;
}

/**
 * What to do about a recent-list entry whose project is not where it used to be.
 *
 * Relocating leads, and is the only action styled as such: a project that vanished from the list's
 * point of view has usually just been moved or renamed, so pointing at it again is both the more
 * common answer and the one that keeps the user's work reachable. Removing is available but plain,
 * and says outright that it touches the list and not the disk - otherwise, next to a message about
 * a deleted folder, it reads like it might delete something.
 */
function MissingProjectDialog({
    project,
    reason,
    error,
    isRelocating,
    onRelocate,
    onRemove,
    onClose,
}: {
    project: RecentlyOpenedProject;
    reason: RecentProjectMissingReason;
    error: string | null;
    isRelocating: boolean;
    onRelocate: () => Promise<void>;
    onRemove: () => Promise<void>;
    onClose: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("launcher.projects.missing.dialogTitle")}
            size="sm"
            fullWindowOverlay
            footer={
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: isRelocating })}
                        onClick={() => void onRemove()}
                        disabled={isRelocating}
                    >
                        {t("launcher.projects.missing.remove")}
                    </button>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: isRelocating })}
                        onClick={() => void onRelocate()}
                        disabled={isRelocating}
                    >
                        {t("launcher.projects.missing.relocate")}
                    </button>
                </div>
            }
        >
            <p className="text-sm text-fg">{t(missingReasonKey(reason))}</p>
            <div className="my-3 rounded-md bg-fill-subtle px-3 py-2">
                <div className="text-sm text-fg truncate">{project.name}</div>
                <div className="text-xs text-fg-subtle break-all">{project.path}</div>
            </div>
            <p className="text-sm text-fg-muted">{t("launcher.projects.missing.note")}</p>
            {error && (
                <div className="mt-3 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                </div>
            )}
        </Modal>
    );
}


