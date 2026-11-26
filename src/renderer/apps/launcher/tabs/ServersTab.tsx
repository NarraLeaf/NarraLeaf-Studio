import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Server } from "lucide-react";
import type { TeamDeepLink } from "@shared/utils/teamDeepLink";
import { deepLinkServerHost } from "@shared/utils/teamDeepLink";

import { getInterface } from "@/lib/app/bridge";
import {
    Button,
    EmptyState,
    IconButton,
    TabStrip,
} from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { getProfile, listProjects, useTeamCapability, useTeamConnection } from "@/lib/team";
import { TeamAvatar } from "@/lib/team/TeamAvatar";
import { useActiveSignIn } from "@/lib/team/TeamAccountMenu";
import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import {
    TEAM_PROJECTS_PLACEMENT_KEY,
    resolveTeamProjectsPlacement,
} from "@/lib/settings/teamProjectsPlacement";
import { cn } from "@/lib/utils/cn";
import {
    serverCan,
    serverDisplayName,
    serverHost,
    signInWithBrowser,
    signInWithPassword,
    useServers,
} from "@/lib/vcs/servers";
import { AddServerModal } from "@/apps/settings/panels";
import type { TranslationKey } from "@shared/i18n";
import { serverProblemFromTeam } from "@shared/types/vcs";
import type {
    VcsLocalRepository,
    VcsServerProject,
    VcsServerSession,
} from "@shared/types/vcs";
import { createProjectFromWizard } from "../projectActions";
import { localCopyOf } from "./localCopy";
import { ServerPeople } from "./ServerPeople";
import { ServerProjectDetailView } from "./ServerProjectDetail";
import { ServerActiveProjects, ServerTodos } from "./ServerOverview";
import { ServerProblemState } from "./ServerProblemState";
import { SERVER_PROBLEM_KEYS } from "./serverProblemKeys";
import {
    CloneProjectDialog,
    ProjectAction,
    isEmptyOnServer,
    lastVersionLine,
    useLocalRepositories,
    useOpenProjectPath,
    useNewTeamProject,
} from "./teamProjectShared";

export { isEmptyOnServer };

/**
 * What exists on the servers this installation is signed in to.
 *
 * **The division with the Projects tab is the design.** Projects answers "what do I have":
 * a list of folders on this disk, every one of them openable. This answers "what is there
 * that I could have", which is a different list with a different thing to do at the end of
 * it, and the two must not be folded together - a recent project is not on this list
 * because it is not news, and a project on a server does not belong on that one because
 * nothing here can be opened without first being fetched.
 *
 * **The launcher window is 800x500 and cannot be resized**, and that decides the shape here
 * more than any judgement about it does: with the navigation column taken off, this tab has
 * 560x460 CSS pixels for everything it draws, and 512x420 inside its own padding.
 *
 * So the screen is a head and a body, and the head is two bands that each answer one
 * question and hold one kind of control:
 *
 * 1. **which server this is**, as a heading - a name, and under it the address and the
 *    account. It is text and not a control. At its right sit the way to the server list, as
 *    an icon, and the one primary control of the current view, and there is never a second
 *    primary. The tab opens on the server last shown (the launcher's active account), and
 *    switching is a screen of its own: the icon puts the list of servers where the views were,
 *    with adding a server as that screen's control, and choosing one goes back to its views.
 * 2. **which view of it is on screen**, as a {@link TabStrip}. Projects and People are two
 *    views of one server rather than two commands, and a tab with an underline is the only
 *    thing on this screen that says so.
 *
 * **One scrolling region at a time.** The project list, one project, and the roster are
 * three views of the same body rather than three boxes dividing it. Each is put away behind
 * the next rather than taken down, so what was read once is not read again and coming back
 * is the list as it was left.
 *
 * Nothing is asked of a server until an author opens it. The list of servers is local, so
 * the menu of them costs nothing; choosing one is the deliberate act that goes to the network, and
 * what is asked for then is what that server said it offers - the projects it holds, and
 * the roster if it has one. **A capability it did not advertise is never asked for**, so a
 * deployment that offers less has fewer sections rather than more errors.
 */

/**
 * The views of one server. Projects is where a reader lands and where a project opens - unless
 * the home list carries the projects (`team.projectsPlacement`), in which case this tab is about
 * the server's people: this account's to-dos, the projects in use now, and the roster.
 */
type ServersView = "projects" | "people" | "todos" | "active";

/**
 * Take a project off a server's list.
 *
 * Handed in rather than called from here, and absent by default: with no handler there is
 * no such action anywhere on the screen. A failed publish can leave a project on a server
 * that nobody can do anything with, and this is the way to be rid of it - the server route
 * behind it drops the listing and nothing else, which is what the dialog says.
 */
export type ForgetServerProject = (
    remoteOrigin: string,
    project: VcsServerProject,
) => Promise<boolean>;

export interface ServersTabProps {
    /**
     * A `narraleaf://` link to act on, and when it arrived (so the same link twice is two
     * requests). `connect` opens Add Server with the address filled in; `open` picks out a
     * server this installation already holds and does nothing for one it does not.
     */
    deepLink?: { link: TeamDeepLink; at: number } | null;
    onForget?: ForgetServerProject;
    /** When the add-server dialog was last asked for from outside this tab, or null. */
    addRequest?: number | null;
}

export function ServersTab({ onForget, deepLink, addRequest }: ServersTabProps = {}) {
    const { t } = useTranslation();
    const { servers, loading, reload } = useServers();
    const [chosen, setChosen] = useState<string | null>(null);
    /** Why fetching a copy through the wizard did not open it. */
    const [wizardError, setOperationError] = useState<string | null>(null);
    const [projects, setProjects] = useState<VcsServerProject[] | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [reading, setReading] = useState(false);
    const { repositories, readLocal } = useLocalRepositories();
    /** Making a project for this server, and the dialog for one it would not take. */
    const { creating, newProject: makeProject, dialog: unsentDialog, openError: sentOpenError } = useNewTeamProject();
    /** Where the launcher lists team projects; "projects" leaves this tab the people views. */
    const placement = useGlobalSetting(TEAM_PROJECTS_PLACEMENT_KEY, resolveTeamProjectsPlacement);
    const peopleMode = placement === "projects";
    /** A project picked from the to-dos or the active list that has no copy here yet. */
    const [cloning, setCloning] = useState<VcsServerProject | null>(null);
    /** Which project is open, by id. The body shows the list or one project, never both. */
    const [opened, setOpened] = useState<string | null>(null);
    /**
     * Which of the server's two views is on screen.
     *
     * Who else is on a server is reference material: it answers a question raised somewhere
     * else, once, and then it is done with. A section holding it open under the projects
     * charged every reading of the project list for a list of colleagues nobody was reading,
     * which on this window is the difference between six project rows and two. So it is a
     * view somebody goes to and comes back from, named on the same tab strip as the one they
     * came from, which stays on screen and lit the whole time they are in it.
     */
    const [view, setView] = useState<ServersView>("projects");
    // Which servers have already been asked what they are, this visit. A refresh is a
    // network call and the answer is a name and a version, so once per server is
    // proportionate and twice is a habit.
    const refreshed = useRef(new Set<string>());
    // Which read is current: an author clicking down a list of servers leaves older reads
    // in flight, and the one that started first must not be the one that lands last.
    const latest = useRef(0);

    /**
     * The server this installation last showed, which is where the tab opens.
     *
     * It is the launcher's active account (`team.activeAccount`), the same one the account menu
     * shows and switches: which server somebody is reading and which account they are looking at
     * are one choice, and recording them apart would let the two disagree.
     */
    const { active, choose } = useActiveSignIn(servers);
    /** Whether the server list is on screen in place of the chosen server's views. */
    const [switching, setSwitching] = useState(false);

    useEffect(() => {
        setChosen(current => current ?? active);
    }, [active]);

    /** Show this server, remember it for the next visit, and put the list away. */
    const pickServer = useCallback((remoteOrigin: string) => {
        setChosen(remoteOrigin);
        choose(remoteOrigin);
        setSwitching(false);
    }, [choose]);

    // When the chosen server's session was signed in. Adding a server again at the same
    // address replaces its session without changing which server is chosen, and the read
    // below has to run again for it: what it answered before was the old session's answer,
    // such as a token this installation no longer has.
    const signedInAt = servers.find(entry => entry.remoteOrigin === chosen)?.signedInAt;

    useEffect(() => {
        if (chosen === null) return;
        const ticket = latest.current + 1;
        latest.current = ticket;
        setReading(true);
        setProblem(null);
        setProjects(null);
        // A project open on the server being left does not stay open on the one arriving,
        // and a reader who was in the roster arrives in the list.
        setOpened(null);
        setView(peopleMode ? "todos" : "projects");

        void (async () => {
            const bridge = getInterface();
            // Once, and only for a server the author has just opened. A session records what
            // its server said the day it was added, and one added before Studio kept any of
            // that has nothing but an address to show; this is the moment that is worth
            // correcting, because it is the moment somebody is looking at the name.
            if (!refreshed.current.has(chosen)) {
                refreshed.current.add(chosen);
                const answered = await bridge.vcs.refreshServer(chosen).catch(() => null);
                if (answered?.success) await reload();
            }
            const result = await listProjects(chosen);
            if (ticket !== latest.current) return;
            setReading(false);
            if (!result.ok) {
                setProblem(SERVER_PROBLEM_KEYS[serverProblemFromTeam(result.problem).kind]);
                return;
            }
            setProjects(result.value.projects);
        })();
    // `peopleMode` is read for the view to land on and is not a reason to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chosen, signedInAt, reload]);

    const session = useMemo(
        () => servers.find(entry => entry.remoteOrigin === chosen) ?? null,
        [servers, chosen],
    );
    /** The list is up while switching, and whenever there is no server to show instead. */
    const showList = switching || session === null;

    // What this server offers, read off what it last said about itself rather than found
    // out by asking. See `serverCan`: a deployment that does not do one of these has no
    // section for it, which is not the same thing as a section that failed.
    //
    // A project's detail and the member roster are answered by the session's own routes now,
    // so what gates them is `session` - the capability a reachable server always advertises.
    // Their reads still go over the REST routes, which the server still serves; the gate only
    // decides whether the surface is drawn at all. Recent revisions are the one thing here a
    // deployment can genuinely lack, so that stays its own gate.
    const canDetail = serverCan(session, "session");
    const canHistory = serverCan(session, "project-history");
    const canMembers = serverCan(session, "session");
    const connection = useTeamConnection(session?.remoteOrigin ?? null);
    const canTodos = useTeamCapability(connection, "todos");
    const canClients = useTeamCapability(connection, "clients");
    /** The views this server has, in the order their tabs are drawn. */
    const views: ServersView[] = peopleMode
        ? [...(canTodos ? ["todos" as const] : []), "active", ...(canMembers ? ["people" as const] : [])]
        : ["projects", ...(canMembers ? ["people" as const] : [])];
    // A view the server does not have (or one from the other placement) lands on the first it
    // does. With one view there is no strip, so it cannot be anything else.
    const current: ServersView = views.includes(view) ? view : views[0] ?? "projects";

    // Switching placement while this tab is up moves it to that placement's first view.
    useEffect(() => {
        setView(peopleMode ? "todos" : "projects");
        setOpened(null);
    }, [peopleMode]);

    /** The project on screen, if the list still has the one that was opened. */
    const openedProject = useMemo(
        () => (opened === null ? null : projects?.find(entry => entry.id === opened) ?? null),
        [opened, projects],
    );

    // Adding a server is the same sequence wherever it is started, so this mounts the one
    // dialog rather than sending somebody to Settings to find it. Settings keeps the list
    // - which servers this installation is signed in to - and this tab keeps what they
    // hold; the dialog belongs to neither and is opened by both.
    const [adding, setAdding] = useState(false);
    const [prefill, setPrefill] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (deepLink == null || loading) return;
        const { link } = deepLink;
        if (link.kind === "connect") {
            setPrefill(link.server);
            setAdding(true);
            return;
        }
        // Only a server already held. A link that names any other is a link anybody could
        // write, and it gets no further than this.
        const wanted = deepLinkServerHost(link.server);
        const held = wanted === undefined ? undefined : servers.find(server => {
            try {
                return new URL(server.authUrl).host.toLowerCase() === wanted;
            } catch {
                return false;
            }
        });
        if (held !== undefined) pickServer(held.remoteOrigin);
    // Acted on once per link: `at` changes with each one, the server list does not need to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deepLink?.at, loading]);

    useEffect(() => {
        if (addRequest != null) setAdding(true);
    }, [addRequest]);

    /** A server was added, so this tab has one more to show and may need to choose it. */
    const serverAdded = useCallback((session: VcsServerSession) => {
        void reload();
        // Chosen straight away when it is the first: an author who has just added their
        // only server did not mean to land on "pick one from the list of one".
        setChosen(current => current ?? session.remoteOrigin);
    }, [reload]);

    /** Fetch a copy of a project through the wizard, then take account of what happened. */
    const getProject = useCallback(async (remote: string) => {
        setOperationError(null);
        try {
            const error = await createProjectFromWizard({ remoteUrl: remote });
            if (error !== null) setOperationError(error || t("launcher.projects.errorCreate"));
        } catch (error) {
            setOperationError(error instanceof Error ? error.message : String(error));
        }
        // A wizard that created something has already opened the workspace and retired this
        // window; one that was cancelled leaves this list on screen, and re-reading is what
        // keeps a project that has since been fetched from still offering to fetch it.
        await readLocal();
    }, [readLocal, t]);

    const { openProject, openError } = useOpenProjectPath();
    const operationError = openError ?? sentOpenError ?? wizardError;

    /** A project picked from the to-dos or the active list: open the copy here, or ask to clone. */
    const pickProject = useCallback((project: VcsServerProject) => {
        const local = localCopyOf(project, repositories);
        if (local !== null) {
            openProject(local.path);
            return;
        }
        // Nothing has been sent, so there is nothing to clone: its page says so.
        if (isEmptyOnServer(project)) {
            setOpened(project.id);
            return;
        }
        setCloning(project);
    }, [repositories, openProject]);

    const newProject = useCallback(async () => {
        if (session !== null) await makeProject(session);
    }, [session, makeProject]);

    /**
     * Take one project off this server's list, and put the list back without it.
     *
     * The server is the authority on what it lists, so a `true` is taken at its word rather
     * than checked by asking again: the answer to "is it gone" is the call that removed it.
     * The project that was open is closed, because there is no longer one to be open on.
     */
    const forgetProject = useCallback(async (project: VcsServerProject) => {
        if (onForget === undefined || chosen === null) return false;
        const gone = await onForget(chosen, project);
        if (!gone) return false;
        setProjects(current => current?.filter(entry => entry.id !== project.id) ?? current);
        setOpened(null);
        return true;
    }, [onForget, chosen]);

    // Nothing until the list has been read. It is a local read and lands in a frame, and
    // that frame is the difference between opening on this tab and opening on the empty
    // state of a tab that has three servers in it.
    if (loading) {
        return null;
    }

    // ❗ One dialog for both branches below, at the same place in the tree. It used to be mounted
    // inside each branch, so adding the first server - which turns the empty tab into the list -
    // unmounted the dialog on its last step and mounted a fresh one on the empty address step.
    const addModal = adding ? (
        <AddServerModal
            onAdded={serverAdded}
            onClose={() => { setAdding(false); setPrefill(undefined); }}
            initialAddress={prefill}
            signInWithPassword={signInWithPassword}
            signInWithBrowser={signInWithBrowser}
        />
    ) : null;

    // Nothing has been added yet, and there is one thing to do about that. Drawn as the
    // whole tab rather than as two empty columns: an empty list beside an empty pane says
    // the same thing twice and offers it once.
    if (servers.length === 0) {
        return (
            <>
            {addModal}
            <div className="h-full w-full" data-servers-tab="empty">
                <EmptyState
                    className="h-full"
                    icon={<Server className="h-8 w-8" />}
                    title={t("launcher.servers.empty.title")}
                    description={t("launcher.servers.empty.description")}
                    action={(
                        <Button
                            size="sm"
                            variant="primary"
                            onClick={() => setAdding(true)}
                            data-servers-action="manage"
                        >
                            {t("launcher.servers.empty.action")}
                        </Button>
                    )}
                />
            </div>
            </>
        );
    }

    return (
        <>
        {addModal}
        <div className="flex h-full w-full min-h-0 flex-col pt-4 px-6 pb-6" data-servers-tab="list">
            {operationError && <p className="mb-2 text-xs text-danger" role="alert">{operationError}</p>}

            <ServerHeading
                    session={showList ? null : session}
                    action={(
                        <div className="flex shrink-0 items-center gap-2">
                            {/* The way to the server list. Pressed while the list is up; pressing
                                it again goes back to the server that was on screen. */}
                            <IconButton
                                size="sm"
                                variant="ghost"
                                className={cn("shrink-0", showList && "bg-fill text-fg")}
                                disabled={session === null}
                                onClick={() => setSwitching(value => !value)}
                                aria-pressed={showList}
                                data-servers-action="switch"
                                data-tip={t("launcher.servers.switch")}
                                aria-label={t("launcher.servers.switch")}
                            >
                                <Server className="h-4 w-4" />
                            </IconButton>
                            {showList && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="shrink-0"
                                    onClick={() => setAdding(true)}
                                    data-servers-action="manage"
                                >
                                    {t("launcher.servers.manage")}
                                </Button>
                            )}
                            {!showList && current !== "people" && openedProject === null && (
                                <Button
                                    size="sm"
                                    variant="primary"
                                    className="shrink-0"
                                    // A server that did not answer the list will not take a project
                                    // either, so the button waits for the list to arrive.
                                    disabled={creating || reading || problem !== null}
                                    onClick={() => void newProject()}
                                    data-servers-action="new-project"
                                >
                                    {t("launcher.servers.newProject")}
                                </Button>
                            )}
                        </div>
                    )}
                />

            {/* The views of the server. The rule under this row is the only line across the
                screen: everything above it says which server and which view, everything below
                it is that view. With no server chosen there is nothing to divide, so no rule. */}
            {!showList && (
            <div
                className="mb-3 flex shrink-0 items-center gap-2 border-b border-edge"
                data-servers-views
            >
                {views.length > 1 && (
                    <TabStrip
                        size="sm"
                        className="min-w-0 flex-1 border-b-0"
                        activeId={current}
                        onChange={id => setView(id as ServersView)}
                        // The attribute rides on the label rather than on the tab, which is
                        // the shared component's own element: a script that clicks it clicks
                        // the tab, because that is where the click lands anyway.
                        tabs={views.map(id => ({
                            id,
                            label: (
                                <span data-servers-action={id}>
                                    {t(VIEW_LABELS[id])}
                                </span>
                            ),
                        }))}
                    />
                )}
            </div>
            )}

            {/* One region, three views, one of them on screen. The two that are not are put
                away rather than taken down: coming back is the list at the scroll position it
                was left at, and the roster read once for this visit rather than again for
                every project somebody looks at. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* The servers to choose from, while switching or with none to show. The chosen
                    server's views stay mounted under it, so going back is where it was left. */}
                {showList && (
                    <div className="min-h-0 overflow-y-auto">
                        <div
                            className="divide-y divide-edge overflow-hidden rounded-md border border-edge"
                            data-servers-choices
                        >
                            {servers.map(entry => (
                                <ServerChoiceRow
                                    key={entry.remoteOrigin}
                                    session={entry}
                                    current={entry.remoteOrigin === session?.remoteOrigin}
                                    onChoose={() => pickServer(entry.remoteOrigin)}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {session !== null && (
                    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", showList && "hidden")}>
                        {canMembers && (
                            <div className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                current !== "people" && "hidden",
                            )}>
                                <ServerPeople remoteOrigin={session.remoteOrigin} />
                            </div>
                        )}
                        {peopleMode && current === "todos" && openedProject === null && (
                            <ServerTodos
                                session={session}
                                projects={projects}
                                repositories={repositories}
                                onPick={pickProject}
                            />
                        )}
                        {peopleMode && current === "active" && openedProject === null && (
                            <ServerActiveProjects
                                session={session}
                                projects={projects}
                                reading={reading}
                                repositories={repositories}
                                canSeeClients={canClients}
                                onPick={pickProject}
                            />
                        )}
                        {openedProject !== null && (
                            <div className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                current === "people" && "hidden",
                            )}>
                                <ServerProjectDetailView
                                    remoteOrigin={session.remoteOrigin}
                                    project={openedProject}
                                    server={serverDisplayName(session)}
                                    account={session.account}
                                    canDetail={canDetail}
                                    canHistory={canHistory}
                                    onBack={() => setOpened(null)}
                                    onForget={onForget === undefined
                                        ? undefined
                                        : () => forgetProject(openedProject)}
                                    action={(
                                        <ProjectAction
                                            project={openedProject}
                                            local={localCopyOf(openedProject, repositories)}
                                            onOpen={openProject}
                                            onGet={remote => void getProject(remote)}
                                        />
                                    )}
                                />
                            </div>
                        )}
                        {/* The catalogue lives on the home list under the default placement. */}
                        {!peopleMode && (
                            <div className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                (current !== "projects" || openedProject !== null) && "hidden",
                            )}>
                                <ProjectList
                                    projects={projects}
                                    problem={problem}
                                    reading={reading}
                                    repositories={repositories}
                                    account={session.account}
                                    onSelect={setOpened}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {unsentDialog}

            {cloning !== null && session !== null && (
                <CloneProjectDialog
                    project={cloning}
                    server={serverDisplayName(session)}
                    onClone={remote => void getProject(remote)}
                    onClose={() => setCloning(null)}
                />
            )}
        </div>
        </>
    );
}

/**
 * Which server this is, as a heading rather than as a row.
 *
 * It used to be the shared {@link ServerRow}, drawn as a button and then told not to look
 * like one (`px-0 hover:bg-transparent`). That component exists so that *lists* of servers
 * read alike in Settings and in the wizard; a page heading is not one of
 * those, and dressing it as a row put a target at the top of the screen that answers nothing.
 * So the order the row reads in is kept - the name, then the address, then whose account this
 * is - and the identity comes from the same two functions, but the element is text.
 */
const VIEW_LABELS: Record<ServersView, TranslationKey> = {
    projects: "launcher.servers.tabs.projects",
    people: "launcher.servers.people.title",
    todos: "launcher.servers.tabs.todos",
    active: "launcher.servers.tabs.active",
};

function ServerHeading({
    session,
    action,
}: {
    /** The server on screen, or null while the server list is. */
    session: VcsServerSession | null;
    /** The controls at the heading's right. */
    action: ReactNode;
}) {
    const { t } = useTranslation();
    const name = session === null ? null : serverDisplayName(session);
    const host = session === null ? null : serverHost(session.remoteOrigin);

    return (
        <div
            className="mb-2 flex shrink-0 items-center gap-3"
            data-server-heading={session?.remoteOrigin}
        >
            <div className="min-w-0 flex-1">
                {session === null ? (
                    <span className="block truncate text-sm text-fg">{t("launcher.servers.switch")}</span>
                ) : (
                    <>
                        <span className="block truncate text-sm text-fg" data-tip={session.authUrl}>
                            {name}
                        </span>
                        <span className="flex gap-3 text-2xs text-fg-subtle">
                            {/* The address is what every project remote and stored session is
                                keyed on, so it stays; it is only dropped where a server that gave
                                no name would have it printed twice. */}
                            {name !== host && <span className="min-w-0 truncate">{host}</span>}
                            <span className="min-w-0 truncate" data-tip={session.account.identity}>
                                {session.account.displayName}
                            </span>
                        </span>
                    </>
                )}
            </div>
            {action}
        </div>
    );
}

/**
 * One server to choose, in the list the body shows while none has been chosen.
 *
 * The rows share one box and a rule between them, the way the project list reads, rather than
 * each standing in a bordered card of its own. The face is this installation's account on that
 * server: its monogram at once, and its avatar once the account's own profile has said where one
 * is. That read is one call per row and is the only thing this list asks of a server.
 */
function ServerChoiceRow({
    session,
    current,
    onChoose,
}: {
    session: VcsServerSession;
    /** Whether this is the server the list was opened from. */
    current: boolean;
    onChoose: () => void;
}) {
    const name = serverDisplayName(session);
    const host = serverHost(session.remoteOrigin);
    const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);

    useEffect(() => {
        let alive = true;
        setAvatarUrl(undefined);
        void getProfile(session.remoteOrigin)
            .then(answer => {
                if (alive && answer.ok) setAvatarUrl(answer.value.avatarUrl);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [session.remoteOrigin, session.account.username]);

    return (
        <button
            type="button"
            onClick={onChoose}
            data-server-choice={session.remoteOrigin}
            aria-current={current || undefined}
            className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left",
                "cursor-default transition-colors duration-150 hover:bg-fill",
            )}
        >
            <TeamAvatar
                remoteOrigin={session.remoteOrigin}
                name={session.account.username}
                avatarUrl={avatarUrl}
                className="h-7 w-7"
            />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg" data-tip={session.authUrl}>{name}</span>
                <span className="flex gap-3 text-2xs text-fg-subtle">
                    {name !== host && <span className="min-w-0 truncate">{host}</span>}
                    <span className="min-w-0 truncate" data-tip={session.account.identity}>
                        {session.account.displayName}
                    </span>
                </span>
            </span>
            {current
                ? <Check aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                : <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />}
        </button>
    );
}

function ProjectList({
    projects,
    problem,
    reading,
    repositories,
    account,
    onSelect,
}: {
    projects: VcsServerProject[] | null;
    problem: TranslationKey | null;
    reading: boolean;
    repositories: readonly VcsLocalRepository[];
    account: VcsServerSession["account"];
    onSelect: (projectId: string) => void;
}) {
    const { t } = useTranslation();

    return (
        // No box of its own. The tab strip's rule is the only line on this screen, and a
        // bordered list hung directly under it drew a second one two pixels away and gave
        // the list the same weight as the head above it.
        <div className="min-h-0 flex-1 overflow-y-auto">
            {reading && <p className="px-3 py-2 text-xs text-fg-subtle">{t("launcher.servers.loading")}</p>}
            {!reading && problem !== null && (
                <ServerProblemState problem={problem} />
            )}
            {!reading && problem === null && projects?.length === 0 && (
                <p className="px-3 py-2 text-xs text-fg-subtle">{t("launcher.servers.noProjects")}</p>
            )}
            {!reading && problem === null && projects?.map(project => (
                <ProjectRow
                    key={project.id}
                    project={project}
                    local={localCopyOf(project, repositories)}
                    account={account}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}

/**
 * One project a server holds, as one place to go.
 *
 * **The row is a single target and the whole of it is that target.** It used to be two: a
 * button around the name that opened the project, and a second button at the end that either
 * opened the copy on this disk or fetched one. Nothing said which was which, the second one
 * changed weight from row to row depending on whether a copy happened to be here, and the
 * two together are how a reader lands somewhere they did not aim for. So the act moved to
 * the project's own page, where it is that page's one primary control, and what is left is a
 * row that goes there - said by the chevron, which is a mark and not a control.
 *
 * The row goes there on every server, including one that answers nothing about a project
 * beyond listing it: the page is then written from what the list already carried, which is
 * the same thing this row was showing. What is *asked* still depends on what the server
 * advertised, which is the part that matters - see `ServerProjectDetailView`.
 *
 * **Whether this machine already has it stays on the row, as a word.** It is the whole
 * question the tab exists to answer, so it did not leave with the button that used to
 * carry it; it reads at the size and colour everything secondary on this screen reads at,
 * beside the description, the way the roster marks an operator. A coloured pill, or a
 * button that changes weight from row to row, is the thing this replaced.
 *
 * **Two lines, not three.** The description, the last version and that word are all things
 * said about the project rather than the project itself, they are all at the secondary
 * size, and the row is wide enough to hold them side by side. The third line was costing
 * every row a fifth of its height for a date.
 */
function ProjectRow({
    project,
    local,
    account,
    onSelect,
}: {
    project: VcsServerProject;
    local: VcsLocalRepository | null;
    account: VcsServerSession["account"];
    onSelect: (projectId: string) => void;
}) {
    const { t, formatDate } = useTranslation();
    const version = lastVersionLine(project, account, t, formatDate);
    // Said on the row rather than only on the page behind it, because it is what decides
    // whether the row leads anywhere: a project with nothing in it has nothing to fetch.
    const empty = isEmptyOnServer(project);
    const said = project.description !== "" || version !== null || empty || local !== null;

    return (
        <button
            type="button"
            onClick={() => onSelect(project.id)}
            data-server-project={project.id}
            data-project-action="select"
            className={cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                "cursor-default transition-colors duration-150 hover:bg-fill",
            )}
        >
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{project.name}</span>
                {said && (
                    <span className="flex gap-2 text-xs text-fg-subtle">
                        {project.description !== "" && (
                            <span className="min-w-0 truncate">{project.description}</span>
                        )}
                        {/* The date and the word hold their width and the description gives
                            way: a truncated description still says what the project is, and
                            half a date says nothing at all. */}
                        {version !== null && <span className="shrink-0">{version}</span>}
                        {empty && (
                            <span className="shrink-0" data-project-empty={project.id}>
                                {t("launcher.servers.nothingSent")}
                            </span>
                        )}
                        {local !== null && (
                            <span className="shrink-0" data-project-here={project.id}>
                                {t("launcher.servers.here")}
                            </span>
                        )}
                    </span>
                )}
            </span>
            <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-subtle" />
        </button>
    );
}
