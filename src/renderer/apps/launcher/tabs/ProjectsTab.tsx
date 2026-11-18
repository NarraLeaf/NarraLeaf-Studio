
import { getInterface } from "@/lib/app/bridge";
import { RecentProjectMissingReason, RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { ConfirmModal, ContextMenu, IconButton, Input, Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import type { ContextMenuDef } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { AlertTriangle, CloudDownload, FolderOpen, MoreVertical, Plus, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { collapseHomePath, normalizeProjectPath } from "@shared/utils/recentProject";
import { isMacPlatform, revealInFileManagerKey } from "@/lib/app/platform";
import { useHomeDir } from "@/lib/app/hooks/useHomeDir";
import { useMissingRecentProjects, useRecentProjectIcons, useRecentProjects, useRemoveRecentProject, useRevealRecentProject } from "@/lib/app/hooks/useRecentProjects";
import { createProjectFromWizard, openProjectFromFolder, relocateRecentProject } from "../projectActions";
import { nameMonogramColor, nameInitials } from "@/lib/components/monogram";
import { useTeamProjects, type TeamProjectFacts } from "@/lib/app/teamProjects";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import { TEAM_PROJECTS_PLACEMENT_KEY, resolveTeamProjectsPlacement } from "@/lib/settings/teamProjectsPlacement";
import { useActiveSignIn } from "@/lib/team/TeamAccountMenu";
import { forgetServerProject, serverCan, serverDisplayName, useServers } from "@/lib/vcs/servers";
import type { VcsServerProject, VcsServerSession } from "@shared/types/vcs";
import { localCopyOf } from "./localCopy";
import { ServerProjectDetailView } from "./ServerProjectDetail";
import {
    CloneProjectDialog,
    ProjectAction,
    isEmptyOnServer,
    lastVersionLine,
    openProjectPath,
    useLocalRepositories,
    useNewTeamProject,
    useServerProjectList,
} from "./teamProjectShared";

export function ProjectsTab() {
    const { t } = useTranslation();
    const [isOpening, setIsOpening] = useState(false);
    const [operationError, setOperationError] = useState<string | null>(null);
    // Live, so a project opened or removed from another window shows up here too.
    const recentProjects = useRecentProjects();
    const removeRecentProject = useRemoveRecentProject();
    const revealRecentProject = useRevealRecentProject();
    // Checked once, on the way into the app - see useMissingRecentProjects.
    const missingByPath = useMissingRecentProjects();
    // The app icon each project ships, for the ones that ship one.
    const iconsByPath = useRecentProjectIcons();
    // The entry whose "cannot find this" dialog is open, if any.
    const [missingTarget, setMissingTarget] = useState<RecentlyOpenedProject | null>(null);
    const [missingError, setMissingError] = useState<string | null>(null);
    const [isRelocating, setIsRelocating] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    // The row whose overflow menu is open, with the screen point to anchor it to.
    const [rowMenu, setRowMenu] = useState<{ project: RecentlyOpenedProject; x: number; y: number } | null>(null);
    // The entry waiting on a "yes, forget this one". Removing is one click in a menu and the row it
    // took away is the only record of where that project lives, so it asks first.
    const [removeTarget, setRemoveTarget] = useState<RecentlyOpenedProject | null>(null);
    const homeDir = useHomeDir();
    const isBusy = isOpening;
    // Which remembered projects work with a Team server, and whether this machine is still
    // connected to it. Keyed on the list's paths so a project added or removed is read at once.
    const { teamProjects, reload: reloadTeamProjects } = useTeamProjects(
        useMemo(() => recentProjects.map(project => project.path).join("\n"), [recentProjects]),
    );
    // The team project whose "cannot open this" dialog is up: its server was signed out of.
    const [teamGate, setTeamGate] = useState<{ project: RecentlyOpenedProject; team: TeamProjectFacts } | null>(null);
    // A team project waiting on "yes, make it personal", or on "yes, delete it".
    const [detachTarget, setDetachTarget] = useState<{ project: RecentlyOpenedProject; team: TeamProjectFacts } | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<RecentlyOpenedProject | null>(null);
    const [teamError, setTeamError] = useState<string | null>(null);
    const [teamBusy, setTeamBusy] = useState(false);

    // The Team server the account menu shows, and - under `team.projectsPlacement = "projects"`,
    // the default - the projects on it that this disk has no copy of yet, listed after the ones
    // it has. Only that one account's: with several signed in, the face in the corner says whose
    // list this is, and switching it there switches this.
    const { servers } = useServers();
    const { active: activeOrigin } = useActiveSignIn(servers);
    const teamSession = useMemo(
        () => servers.find(server => server.remoteOrigin === activeOrigin) ?? null,
        [servers, activeOrigin],
    );
    const placement = useGlobalSetting(TEAM_PROJECTS_PLACEMENT_KEY, resolveTeamProjectsPlacement);
    const listedSession = placement === "projects" ? teamSession : null;
    const serverList = useServerProjectList(listedSession);
    const { repositories, readLocal } = useLocalRepositories();
    const recentKey = useMemo(() => recentProjects.map(project => project.path).join("\n"), [recentProjects]);
    // Which server projects have a copy here follows the list: re-read as it changes.
    useEffect(() => {
        void readLocal();
    }, [recentKey, readLocal]);
    /** Each cloned server project by its copy's path, so a recent row can open its details. */
    const serverProjectByPath = useMemo(() => {
        const out = new Map<string, VcsServerProject>();
        for (const project of serverList.projects ?? []) {
            const local = localCopyOf(project, repositories);
            if (local !== null) out.set(normalizeProjectPath(local.path), project);
        }
        return out;
    }, [serverList.projects, repositories]);
    /** The server's projects with no copy here, the most recently changed first. */
    const unclonedProjects = useMemo(() => (serverList.projects ?? [])
        .filter(project => localCopyOf(project, repositories) === null)
        .sort((a, b) => (b.history?.lastAt ?? 0) - (a.history?.lastAt ?? 0)), [serverList.projects, repositories]);
    /** The server project whose details are up, in a dialog over the list. */
    const [detailTarget, setDetailTarget] = useState<VcsServerProject | null>(null);
    /** The not-yet-cloned project waiting on "yes, clone it". */
    const [cloneTarget, setCloneTarget] = useState<VcsServerProject | null>(null);
    /** The overflow menu of a not-yet-cloned row, or of the "+" button. */
    const [serverRowMenu, setServerRowMenu] = useState<{ project: VcsServerProject; x: number; y: number } | null>(null);
    const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
    const { creating, newProject: makeTeamProject, dialog: unsentDialog } = useNewTeamProject();

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
    // The same substring over what a not-yet-cloned row shows: its name and its description.
    const visibleUncloned = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return unclonedProjects;
        return unclonedProjects.filter(project =>
            project.name.toLowerCase().includes(query)
            || project.description.toLowerCase().includes(query),
        );
    }, [unclonedProjects, searchQuery]);

    /** Pick a not-yet-cloned project: ask to clone it, or show why there is nothing to clone. */
    const handleOpenServerProject = (project: VcsServerProject) => {
        if (isEmptyOnServer(project)) {
            setDetailTarget(project);
            return;
        }
        setCloneTarget(project);
    };

    /** Clone a server project through the wizard, which asks where the copy goes. */
    const handleClone = async (remote: string) => {
        setOperationError(null);
        const error = await createProjectFromWizard({ remoteUrl: remote });
        if (error) setOperationError(error);
        // A wizard that cloned has opened the workspace and retired this window; one that was
        // cancelled leaves this list up, and re-reading keeps it honest about what is here.
        await readLocal();
    };

    const serverRowMenuItems = (project: VcsServerProject): ContextMenuDef => [
        ...(isEmptyOnServer(project) ? [] : [{
            id: "clone",
            label: t("launcher.projects.team.clone.action"),
            onClick: () => setCloneTarget(project),
        }]),
        {
            id: "details",
            label: t("launcher.projects.team.details"),
            onClick: () => setDetailTarget(project),
        },
    ];

    /**
     * The "+" button: straight to the wizard with no Team server signed in, and otherwise a menu
     * of the two things it can make - a project here, or one on the account's server.
     */
    const handleAddClick = (event: MouseEvent<HTMLElement>) => {
        if (isBusy) return;
        if (teamSession === null) {
            void handleAddProject();
            return;
        }
        // Opened leftwards from the button's right edge: the button sits against the window's
        // edge, and a menu placed at its right would be squeezed into wrapping its labels.
        const rect = event.currentTarget.getBoundingClientRect();
        setAddMenu({ x: Math.max(8, rect.right - ADD_MENU_WIDTH), y: rect.bottom + 4 });
    };

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
            // A team project opens only while this machine is connected to its server. Read afresh
            // rather than from the marks on screen: signing out happens in another window, and a
            // project with nothing behind it would open into a team workspace that cannot work.
            const team = (await reloadTeamProjects()).get(normalizeProjectPath(project.path));
            if (team && !team.connected) {
                setTeamError(null);
                setTeamGate({ project, team });
                return;
            }
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

    const handleConfirmRemoveRecentProject = async () => {
        if (!removeTarget) return;
        // The main process rebuilds the list and broadcasts it back, which is what re-renders this
        // one. No optimistic local copy: writing a filtered snapshot back would erase whatever
        // another window did to the history in the meantime.
        await removeRecentProject(removeTarget.path);
        setRemoveTarget(null);
    };

    /**
     * Make a team project personal: its server address goes, its content and history stay, and the
     * workspace offers to reconnect later. Done here, with the project closed, because a project's
     * server settings do not change while it is open.
     */
    const handleDetach = async (project: RecentlyOpenedProject) => {
        setTeamBusy(true);
        setTeamError(null);
        try {
            const result = await getInterface().vcs.detachRecentProject(project.path).catch(() => null);
            if (!result?.success) {
                setTeamError(t(result?.code === "recent-project-open"
                    ? "launcher.projects.team.errorOpen"
                    : "launcher.projects.team.errorDetach"));
                return false;
            }
            await reloadTeamProjects();
            return true;
        } finally {
            setTeamBusy(false);
        }
    };

    /** Move a project's folder to the trash and take it off the list. */
    const handleDelete = async (project: RecentlyOpenedProject) => {
        setTeamBusy(true);
        setTeamError(null);
        try {
            const result = await getInterface().app.trashRecentProject(project.path).catch(() => null);
            if (!result?.success) {
                setTeamError(t(result?.code === "recent-project-open"
                    ? "launcher.projects.team.errorOpen"
                    : "launcher.projects.team.errorDelete"));
                return false;
            }
            return true;
        } finally {
            setTeamBusy(false);
        }
    };

    const trashName = t(isMacPlatform() ? "launcher.projects.team.trashMac" : "launcher.projects.team.trashOther");

    const handleRevealProject = async (project: RecentlyOpenedProject) => {
        setOperationError(null);
        const error = await revealRecentProject(project.path);
        if (error !== null) {
            setOperationError(error || t("launcher.projects.errorReveal"));
        }
    };

    /**
     * The row's overflow menu. Everything here is also reachable another way (a row opens on
     * click, a missing row offers the same two actions in its dialog) - this is the discoverable
     * home for them, not the only one.
     */
    const rowMenuItems = (project: RecentlyOpenedProject): ContextMenuDef => {
        const isMissing = missingByPath.has(normalizeProjectPath(project.path));
        const team = isMissing ? undefined : teamProjects.get(normalizeProjectPath(project.path));
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
            }] : [{
                // Left out for a missing entry: the row already says the folder is gone, and an
                // action whose only possible outcome is an error is not one to offer.
                id: "reveal",
                label: t(revealInFileManagerKey()),
                onClick: () => void handleRevealProject(project),
            }]),
            // What the server knows about it, where the account shown is the one it is on.
            ...(serverProjectByPath.has(normalizeProjectPath(project.path)) ? [{
                id: "details",
                label: t("launcher.projects.team.details"),
                onClick: () => setDetailTarget(serverProjectByPath.get(normalizeProjectPath(project.path)) ?? null),
            }] : []),
            // The one place a team project's server is changed from: outside it.
            ...(team ? [{
                id: "detach",
                label: t("launcher.projects.team.gate.detach"),
                onClick: () => {
                    setTeamError(null);
                    setDetachTarget({ project, team });
                },
            }] : []),
            { id: "sep", separator: true as const },
            {
                id: "remove",
                label: t("launcher.projects.removeFromRecent"),
                onClick: () => setRemoveTarget(project),
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
    // A team project not yet cloned is a project too: the pane stays away while there is one, and
    // while the server is still saying whether there is.
    const overlays = (
        <>
            {addMenu && teamSession && (
                <ContextMenu
                    items={[
                        {
                            id: "new-project",
                            label: t("launcher.projects.addProject"),
                            onClick: () => void handleAddProject(),
                        },
                        {
                            id: "new-team-project",
                            label: t("launcher.projects.team.newOn", { server: serverDisplayName(teamSession) }),
                            disabled: creating,
                            onClick: () => void makeTeamProject(teamSession),
                        },
                    ]}
                    position={addMenu}
                    onClose={() => setAddMenu(null)}
                />
            )}
            {unsentDialog}
            {cloneTarget && teamSession && (
                <CloneProjectDialog
                    project={cloneTarget}
                    server={serverDisplayName(teamSession)}
                    onClone={remote => void handleClone(remote)}
                    onClose={() => setCloneTarget(null)}
                />
            )}
            {detailTarget && teamSession && (
                <ServerProjectDetailModal
                    session={teamSession}
                    project={detailTarget}
                    local={localCopyOf(detailTarget, repositories)}
                    onClone={remote => {
                        setDetailTarget(null);
                        void handleClone(remote);
                    }}
                    onForget={async () => {
                        const gone = await forgetServerProject(teamSession.remoteOrigin, detailTarget);
                        if (gone) {
                            serverList.drop(detailTarget.id);
                            setDetailTarget(null);
                        }
                        return gone;
                    }}
                    onClose={() => setDetailTarget(null)}
                />
            )}
        </>
    );

    if (recentProjects.length === 0 && unclonedProjects.length === 0) {
        return (
            <div className="h-full w-full flex flex-col pt-4 px-6 pb-6 text-fg">
                {operationError && <OperationError message={operationError} />}
                {!(listedSession !== null && serverList.reading) && (
                    <WelcomePane
                        isBusy={isBusy}
                        onAddProject={handleAddClick}
                        onOpenFolder={handleOpenFolder}
                    />
                )}
                {overlays}
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
                    data-tip={t("launcher.projects.openFolder")}
                    aria-label={t("launcher.projects.openFolder")}
                >
                    <FolderOpen className="h-4 w-4" />
                </IconButton>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={handleAddClick}
                    disabled={isBusy}
                    data-tip={t("launcher.projects.addProject")}
                    aria-label={t("launcher.projects.addProject")}
                    data-projects-action="add"
                >
                    <Plus className="h-4 w-4" />
                </IconButton>
            </div>

            {operationError && <OperationError message={operationError} />}
            {/* A conversion asked for from a row's menu has no dialog left open to answer in. */}
            {teamError && !teamGate && <OperationError message={teamError} />}

            <div className="flex-1 min-h-0 overflow-y-auto">
                {visibleProjects.length === 0 && visibleUncloned.length === 0 && (
                    <div className="px-3 py-10 text-center text-sm text-fg-muted">
                        {t("launcher.projects.search.empty", { query: searchQuery.trim() })}
                    </div>
                )}

                {visibleProjects.map((project, index) => {
                    const identity = normalizeProjectPath(project.path);
                    const missingEntry = missingByPath.get(identity);
                    const icon = iconsByPath.get(identity);
                    const team = missingEntry ? undefined : teamProjects.get(identity);
                    return (
                        <div key={`${project.path}-${index}`} className="relative group">
                            <button
                                type="button"
                                onClick={() => handleOpenRecentProject(project)}
                                disabled={isOpening}
                                className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 pr-11 text-left hover:bg-fill transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                                data-tip={t("launcher.projects.openNamed", { name: project.name })}
                            >
                                {/* The project's own app icon when it has one, and the two letters of
                                    its name when it does not. A project that is not there keeps the
                                    monogram either way: the dimming below is what says so, and an icon
                                    reads as a working project however it is tinted. */}
                                {icon && !missingEntry ? (
                                    <img src={icon} alt="" className="flex-shrink-0 w-10 h-10 rounded-lg object-contain" />
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
                                    <span className="flex items-baseline gap-2 min-w-0">
                                        <span className={cn("text-sm truncate", missingEntry ? "text-fg-muted" : "text-fg")}>
                                            {project.name}
                                        </span>
                                        {/* Plain words beside the name rather than a chip: it is a
                                            fact about the project, read once, and the server it is
                                            on is one hover away. */}
                                        {team && (
                                            <span
                                                data-recent-team={team.connected ? "connected" : "disconnected"}
                                                data-tip={t("launcher.projects.team.on", { server: team.server })}
                                                className="flex flex-shrink-0 items-center gap-1 text-2xs text-fg-subtle"
                                            >
                                                <Users className="w-3 h-3" />
                                                {t("launcher.projects.team.label")}
                                            </span>
                                        )}
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
                                    {team && !team.connected && (
                                        <span className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                            <span className="truncate">{t("launcher.projects.team.signedOut", { server: team.server })}</span>
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
                                data-tip={t("launcher.projects.moreActions")}
                                aria-label={t("launcher.projects.moreActionsNamed", { name: project.name })}
                            >
                                <MoreVertical className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}

                {listedSession !== null && visibleUncloned.length > 0 && (
                    <UnclonedGroup
                        session={listedSession}
                        projects={visibleUncloned}
                        disabled={isOpening}
                        onOpen={handleOpenServerProject}
                        onMenu={(project, x, y) => setServerRowMenu({ project, x, y })}
                    />
                )}
            </div>

            {serverRowMenu && (
                <ContextMenu
                    items={serverRowMenuItems(serverRowMenu.project)}
                    position={{ x: serverRowMenu.x, y: serverRowMenu.y }}
                    onClose={() => setServerRowMenu(null)}
                />
            )}

            {overlays}

            {rowMenu && (
                <ContextMenu
                    items={rowMenuItems(rowMenu.project)}
                    position={{ x: rowMenu.x, y: rowMenu.y }}
                    onClose={() => setRowMenu(null)}
                />
            )}

            {removeTarget && (
                <ConfirmModal
                    isOpen
                    onClose={() => setRemoveTarget(null)}
                    onConfirm={() => void handleConfirmRemoveRecentProject()}
                    title={t("launcher.projects.removeConfirm.title")}
                    message={t("launcher.projects.removeConfirm.message", { name: removeTarget.name })}
                    confirmText={t("launcher.projects.removeConfirm.confirm")}
                />
            )}

            {teamGate && (
                <TeamProjectGateDialog
                    project={teamGate.project}
                    server={teamGate.team.server}
                    trashName={trashName}
                    error={teamError}
                    busy={teamBusy}
                    onDetach={async () => {
                        if (await handleDetach(teamGate.project)) setTeamGate(null);
                    }}
                    onDelete={() => {
                        setDeleteTarget(teamGate.project);
                    }}
                    onClose={() => setTeamGate(null)}
                />
            )}

            {detachTarget && (
                <ConfirmModal
                    isOpen
                    onClose={() => setDetachTarget(null)}
                    onConfirm={() => {
                        const target = detachTarget;
                        setDetachTarget(null);
                        void handleDetach(target.project);
                    }}
                    title={t("launcher.projects.team.detachConfirm.title")}
                    message={t("launcher.projects.team.detachConfirm.message", {
                        name: detachTarget.project.name,
                        server: detachTarget.team.server,
                    })}
                    confirmText={t("launcher.projects.team.detachConfirm.confirm")}
                />
            )}

            {deleteTarget && (
                <ConfirmModal
                    isOpen
                    variant="danger"
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={() => {
                        const target = deleteTarget;
                        setDeleteTarget(null);
                        void handleDelete(target).then(done => {
                            if (done) setTeamGate(null);
                        });
                    }}
                    title={t("launcher.projects.team.deleteConfirm.title")}
                    message={t("launcher.projects.team.deleteConfirm.message", { name: deleteTarget.name, trash: trashName })}
                    confirmText={t("launcher.projects.team.deleteConfirm.confirm")}
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

/** Room the "+" menu is given to the left of the button, wide enough for its longer label. */
const ADD_MENU_WIDTH = 288;

/**
 * The team projects on the account's server that have no copy on this disk, after the ones that
 * do. Under its own heading so a row that clones is never mistaken for one that opens, and each
 * row says so with a cloud mark where the others have their icon.
 */
function UnclonedGroup({
    session,
    projects,
    disabled,
    onOpen,
    onMenu,
}: {
    session: VcsServerSession;
    projects: readonly VcsServerProject[];
    disabled: boolean;
    onOpen: (project: VcsServerProject) => void;
    onMenu: (project: VcsServerProject, x: number, y: number) => void;
}) {
    const { t, formatDate } = useTranslation();
    return (
        <div data-projects-uncloned className="mt-3">
            <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-2xs text-fg-subtle">
                <span className="truncate">{t("launcher.projects.team.uncloned", { server: serverDisplayName(session) })}</span>
                <span className="h-px flex-1 bg-edge" aria-hidden />
            </div>
            {projects.map(project => {
                const version = lastVersionLine(project, session.account, t, formatDate);
                const empty = isEmptyOnServer(project);
                return (
                    <div key={project.id} className="relative group">
                        <button
                            type="button"
                            onClick={() => onOpen(project)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                onMenu(project, e.clientX, e.clientY);
                            }}
                            disabled={disabled}
                            data-uncloned-project={project.id}
                            data-tip={empty ? undefined : t("launcher.projects.team.clone.hint", { name: project.name })}
                            className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 pr-11 text-left hover:bg-fill transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <span
                                aria-hidden
                                className="relative flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-medium text-white/90 opacity-60"
                                style={{ backgroundColor: nameMonogramColor(project.name) }}
                            >
                                {nameInitials(project.name)}
                                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-fg-muted">
                                    <CloudDownload className="h-3 w-3" />
                                </span>
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="flex items-baseline gap-2 min-w-0">
                                    <span className="text-sm truncate text-fg">{project.name}</span>
                                    <span className="flex flex-shrink-0 items-center gap-1 text-2xs text-fg-subtle">
                                        <Users className="w-3 h-3" />
                                        {t("launcher.projects.team.label")}
                                    </span>
                                </span>
                                <span className="flex gap-2 text-xs text-fg-subtle">
                                    {project.description !== "" && <span className="min-w-0 truncate">{project.description}</span>}
                                    {version !== null && <span className="shrink-0">{version}</span>}
                                    <span className="shrink-0">
                                        {t(empty ? "launcher.servers.nothingSent" : "launcher.projects.team.notCloned")}
                                    </span>
                                </span>
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                onMenu(project, rect.right, rect.bottom + 4);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-fg-muted opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong transition-opacity cursor-default"
                            data-tip={t("launcher.projects.moreActions")}
                            aria-label={t("launcher.projects.moreActionsNamed", { name: project.name })}
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * A server project's page - description, who made it, its size, its versions, and taking it off
 * the server - as a dialog over the home list, which is where the Team tab's own list used to
 * open it. Its one primary control opens the copy here or clones one.
 */
function ServerProjectDetailModal({
    session,
    project,
    local,
    onClone,
    onForget,
    onClose,
}: {
    session: VcsServerSession;
    project: VcsServerProject;
    local: ReturnType<typeof localCopyOf>;
    onClone: (remote: string) => void;
    onForget: () => Promise<boolean>;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Modal isOpen onClose={onClose} title={t("launcher.projects.team.detailsTitle")} size="lg">
            <div className="flex h-[19rem] min-h-0 flex-col" data-projects-detail={project.id}>
                <ServerProjectDetailView
                    remoteOrigin={session.remoteOrigin}
                    project={project}
                    server={serverDisplayName(session)}
                    account={session.account}
                    canDetail={serverCan(session, "session")}
                    canHistory={serverCan(session, "project-history")}
                    onForget={onForget}
                    action={(
                        <ProjectAction
                            project={project}
                            local={local}
                            onOpen={openProjectPath}
                            onGet={onClone}
                        />
                    )}
                />
            </div>
        </Modal>
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
    onAddProject: (event: MouseEvent<HTMLElement>) => void;
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
    onClick: (event: MouseEvent<HTMLElement>) => void;
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



/**
 * What opening a team project answers once this machine is disconnected from its server.
 *
 * It does not open: a team workspace with no server behind it can neither sync nor say who is
 * editing, and the server's settings are not changed from inside a project. So the two ways out
 * are offered here instead. Converting leads, because it keeps everything; deleting is the plain
 * secondary, and asks again before it moves anything.
 */
function TeamProjectGateDialog({
    project,
    server,
    trashName,
    error,
    busy,
    onDetach,
    onDelete,
    onClose,
}: {
    project: RecentlyOpenedProject;
    server: string;
    trashName: string;
    error: string | null;
    busy: boolean;
    onDetach: () => Promise<void>;
    onDelete: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("launcher.projects.team.gate.title")}
            size="sm"
            footer={
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                        onClick={onDelete}
                        disabled={busy}
                    >
                        {t("launcher.projects.team.gate.delete")}
                    </button>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: busy })}
                        onClick={() => void onDetach()}
                        disabled={busy}
                    >
                        {t("launcher.projects.team.gate.detach")}
                    </button>
                </div>
            }
        >
            <p className="text-sm text-fg">{t("launcher.projects.team.gate.message", { server })}</p>
            <div className="my-3 rounded-md bg-fill-subtle px-3 py-2">
                <div className="text-sm text-fg truncate">{project.name}</div>
                <div className="text-xs text-fg-subtle break-all">{project.path}</div>
            </div>
            <p className="text-sm text-fg-muted">{t("launcher.projects.team.gate.note", { trash: trashName })}</p>
            {error && (
                <div className="mt-3 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                </div>
            )}
        </Modal>
    );
}
