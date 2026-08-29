import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, MoreVertical } from "lucide-react";

import {
    Button,
    ContextMenu,
    FieldLabel,
    IconButton,
    Modal,
    dialogFooterButtonClass,
} from "@/lib/components/elements";
import type { ContextMenuDef } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { getProject, listProjectHistory } from "@/lib/team";
import type { TranslationKey } from "@shared/i18n";
import { serverProblemFromTeam } from "@shared/types/vcs";
import type {
    VcsServerProject,
    VcsServerProjectDetail as ServerProjectDetail,
    VcsServerProjectHistoryPage,
    VcsServerRevision,
} from "@shared/types/vcs";
import { ProjectDiscussion } from "./ProjectDiscussion";
import { ProjectLiveSessions } from "./ServerLiveSessions";
import { SERVER_PROBLEM_KEYS } from "./serverProblemKeys";

/**
 * One project, as the server that holds it knows it.
 *
 * The row above answers whether this machine has the project; this answers what it is -
 * what it is about, who started it, how big it has got, and what has happened to it
 * lately. All of it comes from the server, and the server may know none of it.
 *
 * **That last part is the whole design.** A server records a project the moment it is
 * created and reads its repository afterwards, so there is always a window in which a
 * project exists and nothing is known about its contents; on a deployment whose reader is
 * not working, that window is permanent. So there is no field here that can be filled in
 * from nothing: an absent revision count is not zero, an absent time is not the epoch, and
 * an unreadable file draws one line saying so instead of a row of dashes. What the server
 * said about *why* it has not read the project does not reach this file at all - it is an
 * English sentence written for whoever runs the server, and the line below is written for
 * whoever writes the game.
 *
 * The two questions are asked independently because a deployment may answer one and not
 * the other: `project-detail` fills the facts, `project-history` fills the versions, and a
 * server offering neither never opens this at all. **They are also answered
 * independently**, which is the part that has to be drawn rather than assumed: a server
 * that has read a project can still decline a page of its versions, and one sentence
 * covering both halves would then be a sentence contradicting the facts printed above it.
 * So there are two, and neither is said where the other has already said it.
 */
export interface ServerProjectDetailProps {
    remoteOrigin: string;
    /** The project as the list has it. Everything drawn before the server answers. */
    project: VcsServerProject;
    /** The server's name, for the one sentence that has to say which list is being changed. */
    server: string;
    /**
     * Where this machine keeps this project, or null when it has never had it.
     *
     * Read by the live sessions below, which is the one thing here that acts on it: joining a
     * room means opening the project, and a machine without it has to fetch one first. The list
     * is what knows this, for the reason it knows it for the Open control beside the title.
     */
    localPath: string | null;
    /** Whether this server answers what it knows about one project. */
    canDetail: boolean;
    /** Whether this server answers a project's revisions. */
    canHistory: boolean;
    /**
     * Open or Get: the one primary control this page has.
     *
     * Handed in rather than decided here because the list is what knows whether a copy is
     * on this disk, and a reader who opened a project to look at it before fetching it
     * should not have to go back to the list to fetch it.
     */
    action: React.ReactNode;
    onBack: () => void;
    /**
     * Take this project off the server's list, or nothing where there is no such route.
     *
     * Absent by default, and then the action is not drawn at all - not drawn disabled, not
     * drawn with an explanation. Answers whether the server did it.
     */
    onForget?: () => Promise<boolean>;
}

/**
 * What the two reads came back with, either of them null.
 *
 * Null for a question this server was not asked, and null for one that failed on the way
 * out; the panel tells them apart by what it asked for rather than by what came back.
 */
type Answers = [
    Awaited<ReturnType<typeof getProject>> | null,
    Awaited<ReturnType<typeof listProjectHistory>> | null,
];

export function ServerProjectDetailView({
    remoteOrigin,
    project,
    server,
    localPath,
    canDetail,
    canHistory,
    action,
    onBack,
    onForget,
}: ServerProjectDetailProps) {
    const { t } = useTranslation();
    const [detail, setDetail] = useState<ServerProjectDetail | null>(null);
    const [page, setPage] = useState<VcsServerProjectHistoryPage | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [reading, setReading] = useState(canDetail || canHistory);
    /** Where the overflow menu is open, if it is. */
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    /** Whether the question is being asked. Nothing is removed until it is answered. */
    const [forgetting, setForgetting] = useState(false);
    /**
     * The read that is out, and which project it is for.
     *
     * **One read per project, however many times the effect runs.** React mounts every
     * effect twice outside a packaged build, and two of these arriving together are not
     * one question asked twice: a server reads one checkout at a time, so the second is
     * refused. What it is refused with is an honest "not to hand at this moment", and
     * that is also the answer a guard keeping the newest one would keep - so a panel that
     * asked twice reliably drew the emptier of two answers about a project with a full
     * history. A run that finds a read already out for its project waits on that one.
     */
    const outstanding = useRef<{ key: string; answers: Promise<Answers> } | null>(null);

    useEffect(() => {
        // The whole of what the read depends on, so that a project or a capability
        // changing starts a new one and a second mount joins the one already out.
        const key = `${remoteOrigin}\0${project.id}\0${canDetail}\0${canHistory}`;
        let live = true;
        setDetail(null);
        setPage(null);
        setProblem(null);
        setReading(canDetail || canHistory);
        if (!canDetail && !canHistory) return;

        const answers = outstanding.current?.key === key
            ? outstanding.current.answers
            // Both at once: they are two reads of one project on one connection, and asking
            // in sequence would draw the versions a round trip after the facts.
            : Promise.all([
                canDetail ? getProject(remoteOrigin, project.id) : null,
                canHistory ? listProjectHistory(remoteOrigin, project.id) : null,
            ]);
        outstanding.current = { key, answers };

        void answers.then(([read, history]) => {
            // A reader stepping through projects leaves older reads in flight, and this is
            // no longer the panel that asked for this one.
            if (!live) return;
            setReading(false);

            if (read !== null) {
                if (!read.ok) setProblem(SERVER_PROBLEM_KEYS[serverProblemFromTeam(read.problem).kind]);
                else setDetail(read.value);
            }
            // A history that failed is left silent rather than given a second sentence: the
            // reason is the same one the facts already carry, and a panel that says a server
            // is unreachable twice is a panel that says it badly.
            if (history?.ok) setPage(history.value);
        });

        return () => { live = false; };
    }, [remoteOrigin, project.id, canDetail, canHistory]);

    // What the server answered, or what the list already knew. The list carries the same
    // fields, so a server that has not answered yet is not a screen full of blanks.
    //
    // Where both have spoken, a fact either of them gave is kept: they describe one project
    // a moment apart, neither is the more current, and dropping the history off the list
    // entry because the second answer omitted it would lose something that was said.
    const answered = detail?.project ?? null;
    const known: VcsServerProject = answered === null ? project : {
        ...answered,
        ...(answered.history === undefined && project.history !== undefined
            ? { history: project.history }
            : {}),
    };
    const file = detail?.file ?? null;
    /**
     * The server has nothing inside this project to report.
     *
     * The stronger of the two absences and the one that is about the project itself, so
     * it is the one that gets the sentence naming the project.
     */
    const fileUnread = file !== null && !file.readable;
    /**
     * The server has read the repository and there is nothing in it yet.
     *
     * **Zero revisions is a fact; an absent count is not.** A server that has not read the
     * repository leaves the number out, and that state is the one `fileUnread` covers. A
     * server that read it and counted none is describing a project nobody has sent anything
     * to - which is also why there is no project file to report, so this sentence stands in
     * place of that one rather than beside it.
     */
    const empty = known.history?.revisions === 0;
    /**
     * The page came back carrying no revisions.
     *
     * Absent is never an empty history - an empty array is the other thing, and that one
     * is a fact worth printing. But absent is not "the server has not read this project"
     * either: the versions are asked for separately and refused separately, and a server
     * that has just given a scene count has plainly read it. So this says what is true of
     * the versions and stops there.
     */
    const versionsUnavailable = page !== null && page.revisions === undefined;

    /**
     * Everything else that can be done to this project, which today is one thing.
     *
     * In a menu rather than on the page because it is destructive and nobody came here to
     * do it: an author opens a project to look at it, and the control they must not press
     * by accident is the one that should cost a deliberate second click to reach. The
     * confirmation is where the consequence is written down.
     */
    const menuItems: ContextMenuDef = [{
        id: "forget",
        label: t("launcher.servers.forget.action"),
        onClick: () => setForgetting(true),
    }];

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-server-project-detail={project.id}>
            {/* Above the scroller rather than in it. This is one project inside the list it
                came from, not a screen of its own, and the way back out of it has to be
                where it was left however far down the versions somebody has read. */}
            <div className="shrink-0">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    data-project-action="back"
                    className="-ml-2 mb-2"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {t("launcher.servers.detail.back")}
                </Button>

                <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="truncate text-sm text-fg">{known.name}</h3>
                        {known.description !== "" && (
                            <p className="mt-0.5 text-xs text-fg-muted">{known.description}</p>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {action}
                        {onForget !== undefined && (
                            <IconButton
                                size="sm"
                                variant="ghost"
                                onClick={event => {
                                    const box = event.currentTarget.getBoundingClientRect();
                                    setMenu({ x: box.right, y: box.bottom + 4 });
                                }}
                                data-project-action="more"
                                data-tip={t("launcher.servers.detail.more")}
                                aria-label={t("launcher.servers.detail.moreNamed", { name: known.name })}
                            >
                                <MoreVertical className="h-4 w-4" />
                            </IconButton>
                        )}
                    </div>
                </div>
            </div>

            {menu !== null && (
                <ContextMenu items={menuItems} position={menu} onClose={() => setMenu(null)} />
            )}

            {forgetting && onForget !== undefined && (
                <ForgetProjectDialog
                    name={known.name}
                    server={server}
                    onForget={onForget}
                    onClose={() => setForgetting(false)}
                />
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {reading && (
                    <p className="text-xs text-fg-subtle">{t("launcher.servers.detail.loading")}</p>
                )}
                {problem !== null && <p className="text-xs text-danger">{t(problem)}</p>}

                <Facts project={known} file={file} />

                {empty && (
                    <p className="mt-2 text-xs text-fg-subtle" data-project-empty>
                        {t("launcher.servers.detail.empty")}
                    </p>
                )}

                {fileUnread && !empty && (
                    <p className="mt-2 text-xs text-fg-subtle" data-project-unread>
                        {t("launcher.servers.detail.unread")}
                    </p>
                )}

                {/* Silent where the line above has already said it: "no versions recorded"
                    under a sentence saying nothing has been sent is the same fact given a
                    heading and a box. A count that disagrees with the page still draws, so
                    nothing real is hidden by this. */}
                {page?.revisions !== undefined && (!empty || page.revisions.length > 0) && (
                    <Versions revisions={page.revisions} more={page.more} />
                )}

                {/* Under the same heading the list would have had, because it is about the
                    same thing and a reader looking for the versions looks there. Said only
                    where the line above has not already said it: on a project the server has
                    not read, the versions are missing for the reason already on screen, and
                    a panel that gives one absence two sentences is a panel nobody finishes. */}
                {/* What people have said about this project. Drawn only where the server
                    holds a session and offers conversations, which is what the component
                    itself checks: a deployment that does not is a page with no such
                    section rather than one with an empty one. */}
                {/* Above the conversation, because it is happening now and a note is not.
                    Drawn only where the server offers rooms and there is one open - see
                    `ServerLiveSessions` for why joining is here rather than in the editor. */}
                <ProjectLiveSessions
                    remoteOrigin={remoteOrigin}
                    project={known}
                    localPath={localPath}
                />

                <ProjectDiscussion remoteOrigin={remoteOrigin} projectId={known.id} />

                {versionsUnavailable && !fileUnread && !empty && (
                    <section className="mt-4" data-project-versions-unavailable>
                        <FieldLabel as="div">{t("launcher.servers.detail.versions")}</FieldLabel>
                        <p className="rounded-md border border-edge px-3 py-2 text-xs text-fg-subtle">
                            {t("launcher.servers.detail.versionsUnavailable")}
                        </p>
                    </section>
                )}
            </div>
        </div>
    );
}

/**
 * Ask before taking a project off a server's list.
 *
 * **The sentence is the whole point of the dialog.** "Remove" beside a project name reads as
 * deleting the project, and the route behind this does not do that: it drops the entry the
 * server lists and leaves everything the repository holds where it is. So the project is
 * named, the server is named, and the limit is written out - a reader who is about to be
 * rid of a failed publish and a reader who thinks they are deleting a year of work press
 * the same button, and only one of them should.
 *
 * A refusal is drawn here rather than swallowed: the server can decline, and a dialog that
 * closes on a refusal is a dialog that says the project is gone when it is not.
 */
function ForgetProjectDialog({
    name,
    server,
    onForget,
    onClose,
}: {
    name: string;
    server: string;
    onForget: () => Promise<boolean>;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const submit = async () => {
        if (busy) return;
        setBusy(true);
        setFailed(false);
        const gone = await onForget();
        setBusy(false);
        // Nothing closes this on success: the project it was opened from is gone, and the
        // list that replaces it is what the caller puts on screen.
        if (!gone) setFailed(true);
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("launcher.servers.forget.title")}
            size="sm"
            footer={(
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: busy })}
                        disabled={busy}
                    >
                        {t("launcher.servers.forget.cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={busy}
                        data-servers-action="forget"
                        className={dialogFooterButtonClass({ variant: "danger", disabled: busy })}
                    >
                        {t("launcher.servers.forget.confirm")}
                    </button>
                </div>
            )}
        >
            <p className="text-sm text-fg">{t("launcher.servers.forget.message", { name, server })}</p>
            {failed && (
                <p className="mt-3 text-xs text-danger">{t("launcher.servers.forget.failed")}</p>
            )}
        </Modal>
    );
}

/** One fact: what it is on the left, what the server said on the right. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-3 text-xs">
            <span className="w-24 shrink-0 text-fg-subtle">{label}</span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-2 text-fg-muted">{children}</span>
        </div>
    );
}

/**
 * What the server knows, one line per thing it actually said.
 *
 * Every row here is conditional and none of them has a placeholder: a project whose author
 * the server does not record has no author row, rather than a row saying "unknown". The
 * rows about the contents appear only where the server read the file, so a scene count on
 * screen is always a scene count somebody's server counted.
 */
function Facts({
    project,
    file,
}: {
    project: VcsServerProject;
    file: ServerProjectDetail["file"] | null;
}) {
    const { t, formatDate, formatNumber } = useTranslation();
    const day: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
    const lastAt = project.history?.lastAt;
    const lastBy = project.history?.lastBy?.trim();
    const readable = file?.readable === true ? file : null;
    const stage = readable !== null
        && typeof readable.stageWidth === "number"
        && typeof readable.stageHeight === "number"
        ? `${readable.stageWidth}×${readable.stageHeight}`
        : null;

    return (
        <div className="mt-2 space-y-1">
            {readable?.title !== undefined && readable.title !== project.name && (
                <Fact label={t("launcher.servers.detail.title")}>{readable.title}</Fact>
            )}
            {project.createdBy !== undefined && (
                <Fact label={t("launcher.servers.detail.createdBy")}>{project.createdBy}</Fact>
            )}
            {/* Zero is what a server too old to say sends, and it is not a date. */}
            {project.createdAt > 0 && (
                <Fact label={t("launcher.servers.detail.created")}>
                    {formatDate(project.createdAt, day)}
                </Fact>
            )}
            {typeof lastAt === "number" && lastAt > 0 && (
                <Fact label={t("launcher.servers.detail.lastVersion")}>
                    <span>{formatDate(lastAt, day)}</span>
                    {lastBy !== undefined && lastBy !== "" && <span className="truncate">{lastBy}</span>}
                </Fact>
            )}
            {stage !== null && (
                <Fact label={t("launcher.servers.detail.stage")}>{stage}</Fact>
            )}
            {typeof readable?.scenes === "number" && (
                <Fact label={t("launcher.servers.detail.scenes")}>{formatNumber(readable.scenes)}</Fact>
            )}
            {typeof readable?.assets === "number" && (
                <Fact label={t("launcher.servers.detail.assets")}>{formatNumber(readable.assets)}</Fact>
            )}
        </div>
    );
}

/**
 * The last few versions, newest first.
 *
 * A page rather than the history: this is what has been happening, not a log to walk, and
 * the version rail inside the project is where somebody goes to walk one. That there are
 * older ones is said plainly, so the list is not read as the whole of it.
 *
 * An empty list here is a project that has been read and has no versions yet, which is a
 * real state a project passes through and is drawn as what it is. It is reached only
 * because the absent case was separated out before this was called.
 */
function Versions({ revisions, more }: { revisions: readonly VcsServerRevision[]; more: boolean }) {
    const { t, formatDate } = useTranslation();

    return (
        <section className="mt-4" data-project-versions>
            <FieldLabel as="div">{t("launcher.servers.detail.versions")}</FieldLabel>
            <div className="rounded-md border border-edge">
                {revisions.length === 0 && (
                    <p className="px-3 py-2 text-xs text-fg-subtle">
                        {t("launcher.servers.detail.noVersions")}
                    </p>
                )}
                {revisions.map(revision => (
                    <div
                        key={revision.id}
                        data-project-revision={revision.id}
                        className="border-t border-edge px-3 py-2 first:border-t-0"
                    >
                        {/* A version with no message is still a version; it reads as the id
                            it can be referred to by rather than as a blank line. */}
                        <span className="block truncate text-xs text-fg">
                            {revision.message ?? revision.id.slice(0, 7)}
                        </span>
                        {(revision.by !== undefined || (revision.at ?? 0) > 0) && (
                            <span className="flex gap-2 text-2xs text-fg-subtle">
                                {revision.by !== undefined && (
                                    <span className="min-w-0 truncate">{revision.by}</span>
                                )}
                                {(revision.at ?? 0) > 0 && (
                                    <span className="shrink-0">
                                        {formatDate(revision.at as number, {
                                            year: "numeric",
                                            month: "short",
                                            day: "numeric",
                                        })}
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            {more && (
                <p className="mt-1 text-2xs text-fg-subtle">
                    {t("launcher.servers.detail.olderVersions")}
                </p>
            )}
        </section>
    );
}
