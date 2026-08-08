
import { getInterface } from "@/lib/app/bridge";
import { RecentProjectMissingReason, RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { ContextMenu, IconButton, Input, Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import type { ContextMenuDef } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, FolderOpen, MoreVertical, Plus, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { collapseHomePath, normalizeProjectPath } from "@shared/utils/recentProject";
import { useHomeDir } from "@/lib/app/hooks/useHomeDir";
import { useMissingRecentProjects, useRecentProjects, useRemoveRecentProject } from "@/lib/app/hooks/useRecentProjects";
import { createProjectFromWizard, openProjectFromFolder, relocateRecentProject } from "../projectActions";
import { nameMonogramColor, nameInitials } from "@/lib/components/monogram";

export function ProjectsTab() {
    const { t } = useTranslation();
    const [isOpening, setIsOpening] = useState(false);
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
    const isBusy = isOpening;

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

    /**
     * The one way in for a project that is not already on this disk.
     *
     * Still `createProjectFromWizard` - the wizard is what widened, not this call. It now asks
     * *how* the project should arrive (blank, package, server) before asking anything else.
     */
    const handleAddProject = async () => {
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

    // Before the first project the tab is the welcome pane and nothing else. The header goes with
    // it: a search field over an empty list can only ever return the same emptiness, and its two
    // icons are the same two actions the pane offers at a size an eye lands on.
    if (recentProjects.length === 0) {
        return (
            <div className="h-full w-full flex flex-col pt-4 px-6 pb-6 text-fg">
                {operationError && <OperationError message={operationError} />}
                <WelcomePane
                    isBusy={isBusy}
                    onAddProject={handleAddProject}
                    onOpenFolder={handleOpenFolder}
                />
            </div>
        );
    }

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
                {/* Two buttons, and they answer the only two questions there are: is this project
                    already on this disk, or does it have to be brought in from somewhere?

                    There used to be four. A cloud-download and an upload arrow sat here as
                    separate, unlabelled entry points for "from a server" and "from a package" -
                    two of the three ways to add a project, given equal billing with the toolbar's
                    other icons and no hint that they belonged together. They are now the second
                    and third cards on the wizard's first page, where the question they answer is
                    written down. */}
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
                    onClick={handleAddProject}
                    disabled={isBusy}
                    title={t("launcher.projects.addProject")}
                    aria-label={t("launcher.projects.addProject")}
                >
                    <Plus className="h-4 w-4" />
                </IconButton>
            </div>

            {operationError && <OperationError message={operationError} />}

            <div className="flex-1 min-h-0 overflow-y-auto">
                {visibleProjects.length === 0 && (
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
                                        style={{ backgroundColor: nameMonogramColor(project.name) }}
                                    >
                                        {nameInitials(project.name)}
                                    </span>
                                )}
                                <span className="flex-1 min-w-0">
                                    <span className={cn("block text-sm truncate", missingEntry ? "text-fg-muted" : "text-fg")}>
                                        {project.name}
                                    </span>
                                    {/* Cut the path at its HEAD. Two recents can share a name (two
                                        "Demo"s), and then the only thing telling them apart is the
                                        tail - which is exactly what a trailing ellipsis eats. Same
                                        rtl/ltr pair the version rail uses: the outer box overflows
                                        to the left, the inner span puts the characters back in
                                        reading order. */}
                                    <span
                                        className="block overflow-hidden whitespace-nowrap text-xs text-fg-subtle"
                                        style={{ direction: "rtl", textOverflow: "ellipsis" }}
                                    >
                                        <span style={{ direction: "ltr", unicodeBidi: "embed" }}>
                                            {collapseHomePath(project.path, homeDir)}
                                        </span>
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

function OperationError({ message }: { message: string }) {
    return (
        <div className="mb-3 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message}
        </div>
    );
}

/**
 * What the Projects tab is before there is a project.
 *
 * The whole pane is the two ways in, drawn at the size of the decision they carry: this is the
 * first screen of the product, and the previous version answered it with two 28px rows floating
 * near the top of an otherwise blank pane, under a search field for a list with nothing in it.
 *
 * Only two tiles, because there are only two questions - is the project already on this disk, or
 * does it have to be brought in? The three ways of bringing one in (blank, package, server) are
 * the wizard's first page, where each is written out; splitting them across tiles here would make
 * the first screen of the product a five-way choice between things most authors meet once.
 */
function WelcomePane({
    isBusy,
    onAddProject,
    onOpenFolder,
}: {
    isBusy: boolean;
    onAddProject: () => void;
    onOpenFolder: () => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-8 pb-10 text-center">
            <div>
                <h1 className="text-xl font-medium text-fg">{t("launcher.projects.empty.title")}</h1>
                <p className="mt-2 text-sm text-fg-muted">{t("launcher.projects.empty.subtitle")}</p>
            </div>
            <div className="flex items-start justify-center gap-4">
                <WelcomeAction
                    icon={<Plus className="h-6 w-6" />}
                    label={t("launcher.projects.addProject")}
                    onClick={onAddProject}
                    disabled={isBusy}
                />
                <WelcomeAction
                    icon={<FolderOpen className="h-6 w-6" />}
                    label={t("launcher.projects.empty.openFolder")}
                    onClick={onOpenFolder}
                    disabled={isBusy}
                />
            </div>
        </div>
    );
}

/**
 * One tile: a square that carries the icon, and the label under it.
 *
 * The focus indicator is a border colour on the square rather than a ring, because a ring is a
 * box-shadow and `styles.css` clears box-shadow on every focused `<button>` - see the warning in
 * docs/design-system.md §5.
 */
function WelcomeAction({
    icon,
    label,
    onClick,
    disabled,
}: {
    icon: ReactNode;
    label: string;
    onClick: () => void;
    disabled: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "group flex w-24 flex-col items-center gap-2 cursor-default",
                "text-fg-muted hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed",
                "focus-visible:outline-none",
            )}
        >
            <span className={cn(
                "flex h-16 w-16 items-center justify-center rounded-md",
                // Filled rather than outlined: on the dark theme a `fill-subtle` square inside an
                // `edge` border is a shape you have to look for, and this is the one thing on the
                // screen that has to be found.
                "border border-edge bg-fill transition-colors duration-150",
                "group-hover:bg-fill-strong group-focus-visible:border-primary",
            )}>
                {icon}
            </span>
            <span className="text-sm">{label}</span>
        </button>
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


