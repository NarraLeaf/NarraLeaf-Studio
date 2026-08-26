import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Server } from "lucide-react";

import { getInterface } from "@/lib/app/bridge";
import {
    Button,
    EmptyState,
    IconButton,
    Modal,
    TabStrip,
    dialogFooterButtonClass,
} from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import {
    ServerRow,
    serverCan,
    serverDisplayName,
    serverHost,
    signInWithPassword,
    useServers,
} from "@/lib/vcs/servers";
import { AddServerModal } from "@/apps/settings/panels";
import type { TranslationKey } from "@shared/i18n";
import { parseVcsRemoteUrl } from "@shared/types/vcs";
import type {
    VcsLocalRepository,
    VcsServerProject,
    VcsServerProjectsProblem,
    VcsServerSession,
} from "@shared/types/vcs";
import { createProjectFromWizard } from "../projectActions";
import { ServerPeople } from "./ServerPeople";
import { ServerProjectDetailView } from "./ServerProjectDetail";
import { SERVER_PROBLEM_KEYS } from "./serverProblemKeys";

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
 * So the screen is a head and a body, and the head is three bands that each answer one
 * question and hold one kind of control:
 *
 * 1. **which servers there are**, as a strip of chips, drawn only where there is more than
 *    one to choose between. A column of servers standing permanently down the left spent
 *    256 of the 560 on a list that usually holds one row.
 * 2. **which server this is**, as a heading - a name, and under it the address and the
 *    account. It is text and not a control: it is the subject of the screen, and a heading
 *    that answers a click is a heading somebody clicks by mistake. The one primary control
 *    of the current view sits at its right, and there is never a second.
 * 3. **which view of it is on screen**, as a {@link TabStrip}. Projects and People are two
 *    views of one server rather than two commands, and a tab with an underline is the only
 *    thing on this screen that says so. Adding a server is the one act here that is not
 *    about the server being read, so it sits at the far end of that rule, as an icon.
 *
 * **One scrolling region at a time.** The project list, one project, and the roster are
 * three views of the same body rather than three boxes dividing it. Each is put away behind
 * the next rather than taken down, so what was read once is not read again and coming back
 * is the list as it was left.
 *
 * Nothing is asked of a server until an author opens it. The list of servers is local, so
 * the strip costs nothing; choosing one is the deliberate act that goes to the network, and
 * what is asked for then is what that server said it offers - the projects it holds, and
 * the roster if it has one. **A capability it did not advertise is never asked for**, so a
 * deployment that offers less has fewer sections rather than more errors.
 */

/** The two views of one server. Projects is where a reader lands and where a project opens. */
type ServersView = "projects" | "people";

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
    onForget?: ForgetServerProject;
}

/** Where a project's remote lives, without the repository name on the end. */
function originOf(remote: string): string {
    return parseVcsRemoteUrl(remote)?.origin ?? remote.trim();
}

/**
 * The copy of a server's project this machine already holds, if it holds one.
 *
 * **Matched on the repository id and never on the name.** Two projects are called
 * "Demo" as often as not, and the first thing an author does with a clone is rename the
 * folder it landed in; either would make a name match hand back somebody else's work to
 * open. The id is written once when the repository is made and survives both.
 *
 * A project this machine cannot produce an id for - no repository, an unreadable
 * `.lore/id` - simply does not match. That is the safe direction: the project then offers
 * to fetch a copy, which asks where to put it and touches nothing that is already there,
 * where a wrong match would open the wrong project.
 *
 * More than one local copy of one repository is possible (a second clone in another
 * folder), and then the one configured against this same server is preferred - it is the
 * copy whose pushes reach the projects being listed.
 */
export function localCopyOf(
    project: VcsServerProject,
    repositories: readonly VcsLocalRepository[],
): VcsLocalRepository | null {
    const wanted = project.id.trim().toLowerCase();
    if (wanted === "") return null;
    const matches = repositories.filter(
        entry => (entry.repositoryId ?? "").toLowerCase() === wanted,
    );
    if (matches.length === 0) return null;
    const origin = originOf(project.remote);
    return matches.find(entry => entry.remoteOrigin === origin) ?? matches[0];
}

/**
 * A project the server has read and found nothing inside.
 *
 * **Zero is a fact and absent is not**, which is the whole of the test. A server that has
 * not read a repository leaves the count out - the ordinary state for a project registered
 * a moment ago - and reading that as "empty" would refuse to fetch a project that is
 * perfectly full. Only a count that is there and is zero says nobody has sent anything.
 *
 * What it decides is whether there is anything to fetch. A clone of a repository with no
 * revisions succeeds, writes a `.lore` directory and nothing else, and leaves the folder
 * the author picked holding something that is not a project and cannot be cloned into
 * again - so the answer is to say what is there rather than to offer the copy.
 */
export function isEmptyOnServer(project: VcsServerProject): boolean {
    return project.history?.revisions === 0;
}

export function ServersTab({ onForget }: ServersTabProps = {}) {
    const { t } = useTranslation();
    const { servers, loading, reload } = useServers();
    const [chosen, setChosen] = useState<string | null>(null);
    const [projects, setProjects] = useState<VcsServerProject[] | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [reading, setReading] = useState(false);
    const [repositories, setRepositories] = useState<VcsLocalRepository[]>([]);
    /** Whether the wizard for a new project on this server is up. */
    const [creating, setCreating] = useState(false);
    /** A project made here that the server did not take, and what it was refused with. */
    const [unsent, setUnsent] = useState<UnsentProject | null>(null);
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

    /** What this machine already holds, by repository id. Two file reads per project. */
    const readLocal = useCallback(async () => {
        const result = await getInterface().vcs.listLocalRepositories().catch(() => null);
        setRepositories(result?.success ? result.data.repositories : []);
    }, []);

    useEffect(() => {
        void readLocal();
    }, [readLocal]);

    useEffect(() => {
        // One server is not a choice, so it is not presented as one - the same reading the
        // wizard's picker takes. With several, none is opened until one is asked for: which
        // server to reach is the author's decision, not a default.
        setChosen(current => current ?? (servers.length === 1 ? servers[0]?.remoteOrigin ?? null : null));
    }, [servers]);

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
        setView("projects");

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
            const result = await bridge.vcs.listServerProjects(chosen).catch(() => null);
            if (ticket !== latest.current) return;
            setReading(false);
            if (!result?.success) {
                setProblem("launcher.servers.problem.unknown");
                return;
            }
            if (!result.data.ok) {
                setProblem(SERVER_PROBLEM_KEYS[result.data.problem.kind]);
                return;
            }
            setProjects(result.data.projects);
        })();
    }, [chosen, reload]);

    const session = useMemo(
        () => servers.find(entry => entry.remoteOrigin === chosen) ?? null,
        [servers, chosen],
    );

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
    // A server with no roster has one view, and one tab is not a choice. The strip is then
    // not drawn at all, so the view cannot be anything but the projects.
    const current: ServersView = canMembers ? view : "projects";

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

    /** A server was added, so this tab has one more to show and may need to choose it. */
    const serverAdded = useCallback((session: VcsServerSession) => {
        void reload();
        // Chosen straight away when it is the first: an author who has just added their
        // only server did not mean to land on "pick one from the list of one".
        setChosen(current => current ?? session.remoteOrigin);
    }, [reload]);

    /** Fetch a copy of a project through the wizard, then take account of what happened. */
    const getProject = useCallback(async (remote: string) => {
        await createProjectFromWizard({ remoteUrl: remote });
        // A wizard that created something has already opened the workspace and retired this
        // window; one that was cancelled leaves this list on screen, and re-reading is what
        // keeps a project that has since been fetched from still offering to fetch it.
        await readLocal();
    }, [readLocal]);

    const openProject = useCallback((projectPath: string) => {
        void getInterface().workspace.launch({ projectPath }, true);
    }, []);

    /**
     * Make a project for this server: write it on this disk, then send it there.
     *
     * **In that order, and the order is the fix.** This used to ask the server for a
     * project first and then run the clone flow over what came back - which is a repository
     * with no revisions in it, so the copy that landed was a `.lore` directory and nothing
     * else, reported to the author as "this is not a NarraLeaf project" over a folder they
     * could not clone into a second time. It also left the project it had registered on the
     * server, empty, for somebody to clear up by hand.
     *
     * So the project is made here, by the wizard that makes every other project, and the
     * server is what happens to it afterwards. Nothing is registered until there is
     * something to register, and a wizard closed without finishing leaves the server exactly
     * as it was.
     *
     * **A project that was written and not sent is still the author's project**, so a
     * refusal here does not throw it away and does not pretend it did not happen: it is
     * named, it is on disk, and it opens from the dialog that says so. Connecting it to a
     * server is then the version rail's "Change server", which is the same act with the
     * project in front of them.
     */
    const newProject = useCallback(async () => {
        if (session === null) return;
        setCreating(true);
        setUnsent(null);
        try {
            const made = await getInterface().app.launchProjectWizard({
                publishTo: { remoteOrigin: session.remoteOrigin, server: serverDisplayName(session) },
            }).catch(() => null);
            // Cancelled, or a wizard that never opened. Neither is an error to report: the
            // author is looking at the list they started from.
            if (!made?.success || !made.data?.created) return;

            const { projectPath, projectName, appId } = made.data;
            const name = (projectName ?? "").trim();
            // **The app id, not the name.** A repository is addressed as
            // `lore://host:port/<name>`, which has no room for a space, and a server refuses
            // one that carries anything but letters, digits and separators - so a project
            // called "My Game" would be refused and one called in Chinese would be refused
            // twice over. The app id is `[a-z0-9-]+` by construction, it is required, and it
            // is already what this project is called wherever a machine has to say it. The
            // review page names it, so it is not a substitution made behind the author.
            const repository = (appId ?? "").trim();
            const sent = repository === "" ? null : await getInterface().vcs
                .publishProject(projectPath, session.remoteOrigin, repository)
                .catch(() => null);
            if (sent !== null && sent.success && sent.data.ok) {
                openProject(projectPath);
                return;
            }
            setUnsent({
                name,
                path: projectPath,
                // The server's coded refusal where there is one, and the backend's own
                // sentence where the call threw - connecting and sending refuse that way,
                // and what they say names the remedy.
                problem: sent !== null && sent.success && !sent.data.ok ? sent.data.problem.kind : null,
                detail: sent === null || sent.success ? "" : sent.error ?? "",
            });
        } finally {
            setCreating(false);
        }
    }, [session, openProject]);

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

    // Nothing has been added yet, and there is one thing to do about that. Drawn as the
    // whole tab rather than as two empty columns: an empty list beside an empty pane says
    // the same thing twice and offers it once.
    if (servers.length === 0) {
        return (
            <div className="h-full w-full" data-servers-tab="empty">
                {adding && (
                    <AddServerModal
                        onAdded={serverAdded}
                        onClose={() => setAdding(false)}
                        signInWithPassword={signInWithPassword}
                    />
                )}
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
        );
    }

    return (
        <div className="flex h-full w-full min-h-0 flex-col pt-4 px-6 pb-6" data-servers-tab="list">
            {adding && (
                <AddServerModal
                    onAdded={serverAdded}
                    onClose={() => setAdding(false)}
                    signInWithPassword={signInWithPassword}
                />
            )}

            {/* Drawn only where there is something to choose between, which is the reading
                the wizard's picker already takes. One server is not a choice, and a strip of
                one is a second copy of the name in the heading below it. */}
            {servers.length > 1 && (
                <div className="mb-2 flex shrink-0 flex-wrap gap-1" data-servers-strip>
                    {servers.map(entry => (
                        <ServerRow
                            key={entry.remoteOrigin}
                            session={entry}
                            size="sm"
                            compact
                            chosen={chosen === entry.remoteOrigin}
                            onChoose={() => setChosen(entry.remoteOrigin)}
                            data-server-choice={entry.remoteOrigin}
                        />
                    ))}
                </div>
            )}

            {session !== null && (
                <ServerHeading
                    session={session}
                    // With one server the strip is not drawn, so this heading is the element
                    // that stands for that choice. With several the strip carries them and
                    // this must not be a second copy of one of them.
                    marked={servers.length === 1}
                    action={current === "projects" && openedProject === null ? (
                        <Button
                            size="sm"
                            variant="primary"
                            className="shrink-0"
                            disabled={creating}
                            onClick={() => void newProject()}
                            data-servers-action="new-project"
                        >
                            {t("launcher.servers.newProject")}
                        </Button>
                    ) : null}
                />
            )}

            {/* The two views, and the one act that is not about either of them. The rule
                under this row is the only line across the screen: everything above it says
                which server and which view, everything below it is that view. */}
            <div
                className="mb-3 flex shrink-0 items-center gap-2 border-b border-edge"
                data-servers-views
            >
                {session !== null && canMembers ? (
                    <TabStrip
                        size="sm"
                        className="min-w-0 flex-1 border-b-0"
                        activeId={current}
                        onChange={id => setView(id as ServersView)}
                        tabs={[
                            {
                                id: "projects",
                                // The attribute rides on the label rather than on the tab,
                                // which is the shared component's own element: a script that
                                // clicks it clicks the tab, because that is where the click
                                // lands anyway.
                                label: (
                                    <span data-servers-action="projects">
                                        {t("launcher.servers.tabs.projects")}
                                    </span>
                                ),
                            },
                            {
                                id: "people",
                                label: (
                                    <span data-servers-action="people">
                                        {t("launcher.servers.people.title")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                ) : (
                    <div className="min-h-7 flex-1" />
                )}
                {/* An icon, and a server rather than a plus: beside "New Project" a plus
                    reads as a second way to make one. Adding a server is rare once there is
                    one, and it is the only thing here that is not about the server being
                    read, so it sits at the end of the rule rather than beside the heading. */}
                <IconButton
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => setAdding(true)}
                    data-servers-action="manage"
                    data-tip={t("launcher.servers.manage")}
                    aria-label={t("launcher.servers.manage")}
                >
                    <Server className="h-4 w-4" />
                </IconButton>
            </div>

            {/* One region, three views, one of them on screen. The two that are not are put
                away rather than taken down: coming back is the list at the scroll position it
                was left at, and the roster read once for this visit rather than again for
                every project somebody looks at. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {session === null ? (
                    <EmptyState className="flex-1" title={t("launcher.servers.choose")} />
                ) : (
                    <>
                        {canMembers && (
                            <div className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                current !== "people" && "hidden",
                            )}>
                                <ServerPeople remoteOrigin={session.remoteOrigin} />
                            </div>
                        )}
                        {openedProject !== null && (
                            <div className={cn(
                                "flex min-h-0 flex-1 flex-col",
                                current !== "projects" && "hidden",
                            )}>
                                <ServerProjectDetailView
                                    remoteOrigin={session.remoteOrigin}
                                    project={openedProject}
                                    server={serverDisplayName(session)}
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
                        <div className={cn(
                            "flex min-h-0 flex-1 flex-col",
                            (current !== "projects" || openedProject !== null) && "hidden",
                        )}>
                            <ProjectList
                                projects={projects}
                                problem={problem}
                                reading={reading}
                                repositories={repositories}
                                onSelect={setOpened}
                            />
                        </div>
                    </>
                )}
            </div>

            {unsent !== null && session !== null && (
                <UnsentProjectDialog
                    project={unsent}
                    server={serverDisplayName(session)}
                    onOpen={() => openProject(unsent.path)}
                    onClose={() => setUnsent(null)}
                />
            )}
        </div>
    );
}

/**
 * Which server this is, as a heading rather than as a row.
 *
 * It used to be the shared {@link ServerRow}, drawn as a button and then told not to look
 * like one (`px-0 hover:bg-transparent`). That component exists so that *lists* of servers
 * read alike in Settings, in the wizard and in the strip above; a page heading is not one of
 * those, and dressing it as a row put a target at the top of the screen that answers nothing.
 * So the order the row reads in is kept - the name, then the address, then whose account this
 * is - and the identity comes from the same two functions, but the element is text.
 */
function ServerHeading({
    session,
    marked,
    action,
}: {
    session: VcsServerSession;
    /** Whether this heading is the element standing for the choice of server. */
    marked: boolean;
    /** The one primary control of the view on screen, or nothing where the view has none. */
    action: ReactNode;
}) {
    const name = serverDisplayName(session);
    const host = serverHost(session.remoteOrigin);

    return (
        <div
            className="mb-2 flex shrink-0 items-center gap-3"
            data-server-choice={marked ? session.remoteOrigin : undefined}
        >
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg" data-tip={session.authUrl}>
                    {name}
                </span>
                <span className="flex gap-3 text-2xs text-fg-subtle">
                    {/* The address is what every project remote and stored session is keyed
                        on, so it stays; it is only dropped where a server that gave no name
                        would have it printed twice. */}
                    {name !== host && <span className="min-w-0 truncate">{host}</span>}
                    <span className="min-w-0 truncate" data-tip={session.account.identity}>
                        {session.account.displayName}
                    </span>
                </span>
            </div>
            {action}
        </div>
    );
}

function ProjectList({
    projects,
    problem,
    reading,
    repositories,
    onSelect,
}: {
    projects: VcsServerProject[] | null;
    problem: TranslationKey | null;
    reading: boolean;
    repositories: readonly VcsLocalRepository[];
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
                <p className="px-3 py-2 text-xs text-danger">{t(problem)}</p>
            )}
            {!reading && problem === null && projects?.length === 0 && (
                <p className="px-3 py-2 text-xs text-fg-subtle">{t("launcher.servers.noProjects")}</p>
            )}
            {!reading && problem === null && projects?.map(project => (
                <ProjectRow
                    key={project.id}
                    project={project}
                    local={localCopyOf(project, repositories)}
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
    onSelect,
}: {
    project: VcsServerProject;
    local: VcsLocalRepository | null;
    onSelect: (projectId: string) => void;
}) {
    const { t, formatDate } = useTranslation();
    const version = lastVersionLine(project, t, formatDate);
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

/**
 * Open the copy that is here, or fetch one.
 *
 * **One control, two words.** Either this machine already has the project, in which case
 * there is a folder to open, or it does not, in which case there is a copy to fetch; it is
 * the same act at the same level either way, and it was drawn at two different weights -
 * filled for Open, ghost for Get - which made the answer to "is this already here" a
 * difference in how loud a button is. It is now one button with one appearance, and the
 * only thing that changes is what it says.
 *
 * It is the primary control of the page it sits on, and the only one: the heading above
 * gives up its own while a project is open.
 */
function ProjectAction({
    project,
    local,
    onOpen,
    onGet,
}: {
    project: VcsServerProject;
    local: VcsLocalRepository | null;
    onOpen: (projectPath: string) => void;
    onGet: (remote: string) => void;
}) {
    const { t } = useTranslation();

    // Nothing has been sent to this project, so there is nothing to fetch. Drawn as no
    // control rather than as a refused one: the page below says what is there, and a
    // button that reports "this is not a NarraLeaf project" over a folder it has just
    // filled is the failure this replaced. A copy already on this machine still opens.
    if (local === null && isEmptyOnServer(project)) {
        return null;
    }

    return (
        <Button
            size="sm"
            variant="primary"
            className="shrink-0"
            onClick={() => (local !== null ? onOpen(local.path) : onGet(project.remote))}
            data-project-action={local !== null ? "open" : "get"}
            data-tip={local?.path}
        >
            {t(local !== null ? "launcher.servers.open" : "launcher.servers.get")}
        </Button>
    );
}

/**
 * When the last version was recorded and by whom, or nothing at all.
 *
 * **A server that has not read the repository sends `history: {}`** - an object with no
 * facts in it - and one older than the claim sends nothing; both mean the same thing, and
 * neither means a project with no versions. So the line is written from what is there:
 * absent means silence, never "0 versions", never "never", and never a date in 1970. The
 * time is what the line is about, so a server that named an author and no time still gets
 * silence rather than half a sentence.
 */
function lastVersionLine(
    project: VcsServerProject,
    t: ReturnType<typeof useTranslation>["t"],
    formatDate: ReturnType<typeof useTranslation>["formatDate"],
): string | null {
    const at = project.history?.lastAt;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
    const date = formatDate(at, { year: "numeric", month: "short", day: "numeric" });
    const by = project.history?.lastBy?.trim();
    return by
        ? t("launcher.servers.lastVersionBy", { date, name: by })
        : t("launcher.servers.lastVersion", { date });
}

/**
 * A project that was written on this disk and that its server would not take.
 *
 * Held rather than dropped, because the two halves of the act came apart and only one of
 * them failed: the project exists, it is complete, and it is under version control. What
 * is missing is the connection to the server, which is a thing the workspace can do with
 * the project in front of the author.
 */
interface UnsentProject {
    /** What the project is called, as it was named in the wizard. */
    name: string;
    /** Where it was written. */
    path: string;
    /** The server's coded refusal, when the server gave one. */
    problem: VcsServerProjectsProblem["kind"] | null;
    /** The backend's own sentence, when connecting or sending threw one. */
    detail: string;
}

/**
 * Say that a project was made and not sent, and offer the one thing left to do about it.
 *
 * **It opens the project.** Everything about the failure that the author can act on is in
 * the workspace: the version rail is where a project is pointed at a server, and it is the
 * same three steps this just tried, with the state visible. A dialog that only apologised
 * would leave a finished project on disk that nothing in Studio had a way back to.
 *
 * The reason is drawn where there is one to draw. A server that refused says so in the
 * reader's language through the shared table; a call that threw carries the backend's own
 * sentence, which names the remedy and is passed on the way the version rail passes it.
 */
function UnsentProjectDialog({
    project,
    server,
    onOpen,
    onClose,
}: {
    project: UnsentProject;
    server: string;
    onOpen: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const reason = project.problem === null ? "" : t(SERVER_PROBLEM_KEYS[project.problem]);

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("launcher.servers.unsent.title")}
            size="sm"
            footer={(
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className={dialogFooterButtonClass({ variant: "secondary" })}
                    >
                        {t("launcher.servers.unsent.close")}
                    </button>
                    <button
                        type="button"
                        onClick={onOpen}
                        data-servers-action="open-unsent"
                        className={dialogFooterButtonClass({ variant: "primary" })}
                    >
                        {t("launcher.servers.unsent.open")}
                    </button>
                </div>
            )}
        >
            <div className="space-y-2">
                <p className="text-sm text-fg">
                    {t("launcher.servers.unsent.message", { name: project.name, server })}
                </p>
                {reason !== "" && <p className="text-xs text-fg-muted">{reason}</p>}
                {project.detail !== "" && (
                    <p className="break-words text-xs text-fg-muted">{project.detail}</p>
                )}
                <p className="break-all text-2xs text-fg-subtle">{project.path}</p>
            </div>
        </Modal>
    );
}
