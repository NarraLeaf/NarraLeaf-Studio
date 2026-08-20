import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Server } from "lucide-react";

import { getInterface } from "@/lib/app/bridge";
import {
    Button,
    CONTROL_HEIGHT_CLASS,
    EmptyState,
    FieldLabel,
    Input,
    Modal,
    dialogFooterButtonClass,
} from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ServerRow, serverCan, serverDisplayName, serverHost, signInWithPassword, useServers } from "@/lib/vcs/servers";
import { AddServerModal } from "@/apps/settings/panels";
import type { TranslationKey } from "@shared/i18n";
import { parseVcsRemoteUrl } from "@shared/types/vcs";
import type {
    VcsLocalRepository,
    VcsServerProject,
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
 * that I could have", which is a different list with a different action at the end of each
 * row, and the two must not be folded together - a recent project is not on this list
 * because it is not news, and a project on a server does not belong on that one because
 * nothing here can be opened without first being fetched.
 *
 * Nothing is asked of a server until an author opens it. The list of servers is local, so
 * the left column costs nothing; choosing one is the deliberate act that goes to the
 * network, and what is asked for then is what that server said it offers - the projects it
 * holds, and the roster if it has one. **A capability it did not advertise is never asked
 * for**, so a deployment that offers less has fewer sections rather than more errors.
 */

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
 * `.lore/id` - simply does not match. That is the safe direction: the row then offers to
 * fetch a copy, which asks where to put it and touches nothing that is already there,
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

export function ServersTab() {
    const { t } = useTranslation();
    const { servers, loading, reload } = useServers();
    const [chosen, setChosen] = useState<string | null>(null);
    const [projects, setProjects] = useState<VcsServerProject[] | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [reading, setReading] = useState(false);
    const [repositories, setRepositories] = useState<VcsLocalRepository[]>([]);
    const [creating, setCreating] = useState(false);
    /** Which project is open, by id. The pane shows the list or one project, never both. */
    const [opened, setOpened] = useState<string | null>(null);
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
        // A project open on the server being left does not stay open on the one arriving.
        setOpened(null);

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
    const canDetail = serverCan(session, "project-detail");
    const canHistory = serverCan(session, "project-history");
    const canOpenProject = canDetail || canHistory;

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
        // keeps a row that has since been fetched from still offering to fetch it.
        await readLocal();
    }, [readLocal]);

    const openProject = useCallback((projectPath: string) => {
        void getInterface().workspace.launch({ projectPath }, true);
    }, []);

    const createProject = useCallback(async (name: string, description: string) => {
        if (chosen === null) return false;
        const made = await getInterface().vcs
            .createServerProject(chosen, name, description || undefined)
            .catch(() => null);
        if (!made?.success || !made.data.ok) return false;
        setCreating(false);
        await getProject(made.data.project.remote);
        return true;
    }, [chosen, getProject]);

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
                        <Button size="sm" onClick={() => setAdding(true)} data-servers-action="manage">
                            {t("launcher.servers.empty.action")}
                        </Button>
                    )}
                />
            </div>
        );
    }

    return (
        <div className="flex h-full w-full min-h-0" data-servers-tab="list">
            {adding && (
                <AddServerModal
                    onAdded={serverAdded}
                    onClose={() => setAdding(false)}
                    signInWithPassword={signInWithPassword}
                />
            )}
            <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-edge p-3">
                {servers.map(entry => (
                    <ServerRow
                        key={entry.remoteOrigin}
                        session={entry}
                        size="md"
                        chosen={chosen === entry.remoteOrigin}
                        onChoose={() => setChosen(entry.remoteOrigin)}
                        data-server-choice={entry.remoteOrigin}
                    />
                ))}
                {/* The last row of the list rather than a control beside it: an author whose
                    server is not in the list looks at the end of the list. */}
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    data-servers-action="manage"
                    className={cn(
                        "flex items-center gap-2 rounded-md border border-dashed border-edge px-3",
                        "text-left text-sm text-fg-muted transition-colors duration-150 cursor-default",
                        "hover:bg-fill hover:text-fg",
                        CONTROL_HEIGHT_CLASS.md,
                    )}
                >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    {t("launcher.servers.manage")}
                </button>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-1 flex-col pt-4 px-6 pb-6">
                {session === null ? (
                    <EmptyState className="flex-1" title={t("launcher.servers.choose")} />
                ) : (
                    <>
                        <ServerHeader session={session} onNewProject={() => setCreating(true)} />
                        {openedProject !== null && (
                            <ServerProjectDetailView
                                remoteOrigin={session.remoteOrigin}
                                project={openedProject}
                                canDetail={canDetail}
                                canHistory={canHistory}
                                onBack={() => setOpened(null)}
                                action={(
                                    <ProjectAction
                                        project={openedProject}
                                        local={localCopyOf(openedProject, repositories)}
                                        onOpen={openProject}
                                        onGet={remote => void getProject(remote)}
                                    />
                                )}
                            />
                        )}
                        {/* Put away behind the project on screen rather than taken down.
                            Coming back is meant to be the list as it was left - the same
                            scroll position, and the roster read once for this visit rather
                            than again for every project somebody looks at. */}
                        <div className={cn(
                            "flex min-h-0 flex-1 flex-col",
                            openedProject !== null && "hidden",
                        )}>
                            <ProjectList
                                projects={projects}
                                problem={problem}
                                reading={reading}
                                repositories={repositories}
                                onOpen={openProject}
                                onGet={remote => void getProject(remote)}
                                onSelect={canOpenProject ? setOpened : null}
                            />
                            {/* Under the projects, because that is the order the questions
                                come in: what is here, then who else is. */}
                            {serverCan(session, "members") && (
                                <ServerPeople remoteOrigin={session.remoteOrigin} />
                            )}
                        </div>
                    </>
                )}
            </section>

            {creating && session !== null && (
                <NewProjectDialog
                    server={serverDisplayName(session)}
                    onCreate={createProject}
                    onClose={() => setCreating(false)}
                />
            )}
        </div>
    );
}

/** Which server is being read, whose it is here, and the one thing that can be added to it. */
function ServerHeader({
    session,
    onNewProject,
}: {
    session: VcsServerSession;
    onNewProject: () => void;
}) {
    const { t } = useTranslation();

    return (
        <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
                <h2 className="truncate text-base text-fg">{serverDisplayName(session)}</h2>
                {/* The address stays visible: it is what every project's remote is written
                    against, and a name is a label a deployment can change. */}
                <p className="truncate text-xs text-fg-subtle">{serverHost(session.remoteOrigin)}</p>
                <p className="truncate text-2xs text-fg-subtle" data-tip={session.account.identity}>
                    {t("launcher.servers.signedInAs", { name: session.account.displayName })}
                </p>
            </div>
            <Button
                size="sm"
                onClick={onNewProject}
                data-servers-action="new-project"
                className="shrink-0"
            >
                {t("launcher.servers.newProject")}
            </Button>
        </div>
    );
}

function ProjectList({
    projects,
    problem,
    reading,
    repositories,
    onOpen,
    onGet,
    onSelect,
}: {
    projects: VcsServerProject[] | null;
    problem: TranslationKey | null;
    reading: boolean;
    repositories: readonly VcsLocalRepository[];
    onOpen: (projectPath: string) => void;
    onGet: (remote: string) => void;
    /** Null where this server says nothing about a project beyond listing it. */
    onSelect: ((projectId: string) => void) | null;
}) {
    const { t } = useTranslation();

    return (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-edge">
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
                    onOpen={onOpen}
                    onGet={onGet}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}

/**
 * One project a server holds, and the one thing to do about it.
 *
 * Either this machine already has it, in which case there is a folder to open, or it does
 * not, in which case there is a copy to fetch. Never both, and never neither: two actions
 * on a row where only one of them can apply is a row that has to be read before it can be
 * used.
 *
 * The name reads on into what the server knows about the project, where the server knows
 * anything. It is a control of its own rather than the whole row, because the row already
 * ends in a control and a button inside a button is neither.
 */
function ProjectRow({
    project,
    local,
    onOpen,
    onGet,
    onSelect,
}: {
    project: VcsServerProject;
    local: VcsLocalRepository | null;
    onOpen: (projectPath: string) => void;
    onGet: (remote: string) => void;
    onSelect: ((projectId: string) => void) | null;
}) {
    const { t, formatDate } = useTranslation();
    const version = lastVersionLine(project, t, formatDate);

    const body = (
        <>
            <span className="block truncate text-sm text-fg">{project.name}</span>
            {project.description !== "" && (
                <span className="block truncate text-xs text-fg-subtle">{project.description}</span>
            )}
            {version !== null && (
                <span className="block truncate text-2xs text-fg-subtle">{version}</span>
            )}
        </>
    );

    return (
        <div
            data-server-project={project.id}
            className="flex items-center gap-3 border-t border-edge px-3 py-2.5 transition-colors duration-150 first:border-t-0 hover:bg-fill-subtle"
        >
            {onSelect === null ? (
                <span className="min-w-0 flex-1">{body}</span>
            ) : (
                <button
                    type="button"
                    onClick={() => onSelect(project.id)}
                    data-project-action="select"
                    className="min-w-0 flex-1 cursor-default text-left"
                >
                    {body}
                </button>
            )}
            <ProjectAction project={project} local={local} onOpen={onOpen} onGet={onGet} />
        </div>
    );
}

/**
 * Open the copy that is here, or fetch one.
 *
 * One component for the row and for the project opened out of it, so that the action does
 * not change wording or behaviour depending on which of the two a reader is looking at -
 * and so that a project fetched from the detail leaves the same list re-read behind it.
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

    return local !== null ? (
        <Button
            size="sm"
            onClick={() => onOpen(local.path)}
            data-project-action="open"
            data-tip={local.path}
            className="shrink-0"
        >
            {t("launcher.servers.open")}
        </Button>
    ) : (
        <Button
            size="sm"
            variant="ghost"
            onClick={() => onGet(project.remote)}
            data-project-action="get"
            className="shrink-0"
        >
            {t("launcher.servers.get")}
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
 * Make a project on this server.
 *
 * The server both records it and creates the repository, so this is the one call; what
 * comes back is a remote, and a remote is what the clone flow takes. Nothing is written to
 * this disk here - where the copy lands is asked by the wizard, on the page that opens the
 * native folder picker.
 */
function NewProjectDialog({
    server,
    onCreate,
    onClose,
}: {
    server: string;
    onCreate: (name: string, description: string) => Promise<boolean>;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const ready = name.trim() !== "" && !busy;

    const submit = async () => {
        if (!ready) return;
        setBusy(true);
        setFailed(false);
        const made = await onCreate(name.trim(), description.trim());
        setBusy(false);
        if (!made) setFailed(true);
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("launcher.servers.create.title", { server })}
            size="sm"
            footer={(
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                        disabled={busy}
                    >
                        {t("launcher.servers.create.cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={!ready}
                        data-servers-action="create"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: !ready })}
                    >
                        {t("launcher.servers.create.submit")}
                    </button>
                </div>
            )}
        >
            <div className="space-y-3">
                <div>
                    {/* Named on the control rather than through `htmlFor`: `FieldLabel` is the
                        shared eyebrow and carries no `for`, so the accessible name goes where
                        it can be relied on. */}
                    <FieldLabel as="div">{t("launcher.servers.create.name")}</FieldLabel>
                    <Input
                        aria-label={t("launcher.servers.create.name")}
                        fullWidth
                        autoFocus
                        value={name}
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void submit();
                            }
                        }}
                    />
                </div>
                <div>
                    <FieldLabel as="div">{t("launcher.servers.create.description")}</FieldLabel>
                    <Input
                        aria-label={t("launcher.servers.create.description")}
                        fullWidth
                        value={description}
                        placeholder={t("launcher.servers.create.descriptionOptional")}
                        onChange={event => setDescription(event.target.value)}
                    />
                </div>
                {failed && (
                    <p className="text-xs text-danger">{t("launcher.servers.create.failed")}</p>
                )}
            </div>
        </Modal>
    );
}
