import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { getInterface } from "@/lib/app/bridge";
import { Button, FieldLabel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type {
    VcsServerProject,
    VcsServerProjectDetail as ServerProjectDetail,
    VcsServerProjectHistoryPage,
    VcsServerRevision,
} from "@shared/types/vcs";
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
 * server offering neither never opens this at all.
 */
export interface ServerProjectDetailProps {
    remoteOrigin: string;
    /** The project as the list has it. Everything drawn before the server answers. */
    project: VcsServerProject;
    /** Whether this server answers what it knows about one project. */
    canDetail: boolean;
    /** Whether this server answers a project's revisions. */
    canHistory: boolean;
    /**
     * Open or Get, as the row drew it.
     *
     * Handed in rather than decided here so that the one action a project has is the same
     * control in both places: a reader who opened a project to look at it before fetching
     * it should not have to go back to the list to fetch it.
     */
    action: React.ReactNode;
    onBack: () => void;
}

export function ServerProjectDetailView({
    remoteOrigin,
    project,
    canDetail,
    canHistory,
    action,
    onBack,
}: ServerProjectDetailProps) {
    const { t } = useTranslation();
    const [detail, setDetail] = useState<ServerProjectDetail | null>(null);
    const [page, setPage] = useState<VcsServerProjectHistoryPage | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [reading, setReading] = useState(canDetail || canHistory);
    // Which read is current, for the same reason the tab keeps one: a reader stepping
    // through projects leaves older reads in flight.
    const latest = useRef(0);

    useEffect(() => {
        const ticket = latest.current + 1;
        latest.current = ticket;
        setDetail(null);
        setPage(null);
        setProblem(null);
        setReading(canDetail || canHistory);
        if (!canDetail && !canHistory) return;

        void (async () => {
            const bridge = getInterface();
            // Both at once: they are two reads of one project on one connection, and asking
            // in sequence would draw the versions a round trip after the facts.
            const [read, history] = await Promise.all([
                canDetail
                    ? bridge.vcs.getServerProject(remoteOrigin, project.id).catch(() => null)
                    : null,
                canHistory
                    ? bridge.vcs.listServerProjectHistory(remoteOrigin, project.id).catch(() => null)
                    : null,
            ]);
            if (ticket !== latest.current) return;
            setReading(false);

            if (read !== null) {
                if (!read.success) setProblem("launcher.servers.problem.unknown");
                else if (!read.data.ok) setProblem(SERVER_PROBLEM_KEYS[read.data.problem.kind]);
                else setDetail(read.data.detail);
            }
            // A history that failed is left silent rather than given a second sentence: the
            // reason is the same one the facts already carry, and a panel that says a server
            // is unreachable twice is a panel that says it badly.
            if (history?.success && history.data.ok) setPage(history.data.page);
        })();
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
    // Absent revisions on an answer that came back is the server saying it has not read
    // this project - never an empty history. An empty array is the other thing, and that
    // one is a fact worth printing.
    const versionsUnread = page !== null && page.revisions === undefined;
    const fileUnread = file !== null && !file.readable;

    return (
        <div className="min-h-0 flex-1 overflow-y-auto" data-server-project-detail={project.id}>
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
                <div className="shrink-0">{action}</div>
            </div>

            {reading && (
                <p className="text-xs text-fg-subtle">{t("launcher.servers.detail.loading")}</p>
            )}
            {problem !== null && <p className="text-xs text-danger">{t(problem)}</p>}

            <Facts project={known} file={file} />

            {(fileUnread || versionsUnread) && (
                <p className="mt-2 text-xs text-fg-subtle" data-project-unread>
                    {t("launcher.servers.detail.unread")}
                </p>
            )}

            {page?.revisions !== undefined && (
                <Versions revisions={page.revisions} more={page.more} />
            )}
        </div>
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
