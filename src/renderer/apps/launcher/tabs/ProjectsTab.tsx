
import { getInterface } from "@/lib/app/bridge";
import { RecentProjectMissingReason, RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { Button, Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, FolderOpen, Plus, Upload, X } from "lucide-react";
import { useState } from "react";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { useMissingRecentProjects, useRecentProjects, useRemoveRecentProject } from "@/lib/app/hooks/useRecentProjects";
import { createProjectFromWizard, openProjectFromFolder, relocateRecentProject } from "../projectActions";

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
    const isBusy = isOpening || isImporting;

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
        <div className="h-full w-full pt-6 px-8 pb-8 text-fg">
            <div className="flex items-center justify-between mb-6">
                <div className="text-lg font-semibold">{t("launcher.projects.title")}</div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={handleOpenFolder}
                        disabled={isBusy}
                        className="h-9 w-9 px-0 text-fg-muted"
                        title={t("launcher.projects.openFolder")}
                        aria-label={t("launcher.projects.openFolder")}
                    >
                        <FolderOpen className="w-5 h-5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={handleImportProject}
                        disabled={isBusy}
                        className="h-9 w-9 px-0 text-fg-muted"
                        title={t("launcher.projects.importProject")}
                        aria-label={t("launcher.projects.importProject")}
                    >
                        <Upload className="w-5 h-5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={handleNewProject}
                        disabled={isBusy}
                        className="text-fg-muted"
                        title={t("launcher.projects.newProject")}
                    >
                        <Plus className="w-4 h-4" />
                        <span>{t("launcher.projects.newProject")}</span>
                    </Button>
                </div>
            </div>

            {operationError && (
                <div className="mb-4 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {operationError}
                </div>
            )}

            {recentProjects.length > 0 && (
                <div className="mb-6">
                    {/* <div className="flex items-center gap-2 mb-3 text-sm text-fg-muted">
                        <Clock className="w-4 h-4" />
                        <span>Recent Projects</span>
                    </div> */}
                    <div className="space-y-2">
                        {recentProjects.map((project, index) => {
                            const missingEntry = missingByPath.get(normalizeProjectPath(project.path));
                            return (
                            <div
                                key={`${project.path}-${index}`}
                                className="relative group rounded-md bg-fill-subtle hover:bg-fill transition-colors"
                            >
                                <button
                                    type="button"
                                    onClick={() => handleOpenRecentProject(project)}
                                    disabled={isOpening}
                                    className="w-full p-3 pr-11 text-left rounded-md transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={t("launcher.projects.openNamed", { name: project.name })}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex-shrink-0 w-8 h-8 bg-fill rounded-md flex items-center justify-center">
                                            {missingEntry ? (
                                                <AlertTriangle className="w-4 h-4 text-warning" />
                                            ) : project.icon ? (
                                                <img
                                                    src={project.icon}
                                                    alt=""
                                                    className="w-5 h-5 object-contain"
                                                />
                                            ) : (
                                                <FolderOpen className="w-4 h-4 text-fg-muted" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className={missingEntry
                                                ? "text-sm font-medium text-fg-muted truncate"
                                                : "text-sm font-medium text-fg truncate"}>
                                                {project.name}
                                            </div>
                                            {missingEntry && (
                                                <div className="text-xs text-warning truncate">
                                                    {t(missingReasonKey(missingEntry.reason))}
                                                </div>
                                            )}
                                            <div className="text-xs text-fg-subtle truncate">
                                                {project.path}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleRemoveRecentProject(project);
                                    }}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-fg-muted opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong transition-opacity cursor-default"
                                    title={t("launcher.projects.removeFromRecent")}
                                    aria-label={t("launcher.projects.removeNamedFromRecent", { name: project.name })}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            );
                        })}
                    </div>
                </div>
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


