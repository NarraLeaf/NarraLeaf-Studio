import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Button, FieldLabel, Input } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import {
    createThread,
    listReactions,
    listThreads,
    listWatches,
    resolveThread,
    setWatch,
    toggleReaction,
    useTeamConnection,
    useTeamTopics,
    type TeamOutcome,
    type ThreadPage,
} from "@/lib/team";
import {
    TEAM_REACTIONS,
    teamProjectThreadsTopic,
    type TeamReaction,
    type TeamReactionEmoji,
    type TeamThread,
} from "@shared/types/team";

/** A list of threads, and the reactions on each opening comment where the server keeps them. */
interface DiscussionPage extends ThreadPage {
    reactions: TeamReaction[];
}

/**
 * What people have said about one project.
 *
 * The first thing Studio reads over a session rather than out of a request, and the first
 * it is told about without asking: a note somebody else writes appears here while this is
 * open. That is the whole reason the protocol grew a session, and this is where it shows.
 *
 * **Only drawn where the server offers it.** A deployment that does not serve
 * conversations has no section here at all - not an empty one, not a disabled one. The
 * capability is read off the session and matched, never discovered by asking and being
 * refused.
 *
 * A note written here is about the project rather than about anything inside it, so it
 * carries no document. The same call takes a document and an element, which is what a
 * note on a line of a story will use; nothing about this screen is in the way of that.
 */
export interface ProjectDiscussionProps {
    remoteOrigin: string;
    /** The project's repository id, as the server holds it. */
    projectId: string;
}

export function ProjectDiscussion({ remoteOrigin, projectId }: ProjectDiscussionProps) {
    const connection = useTeamConnection(remoteOrigin);
    // What the server said it serves, which it goes on having said while the session is
    // down - see `TeamClient.dropped`. A section that disappeared when a server restarted
    // would be saying "this deployment does not do that", which is a different thing.
    if (!connection.capabilities.includes("comments")) {
        return null;
    }
    return (
        <Discussion
            remoteOrigin={remoteOrigin}
            projectId={projectId}
            settled={connection.state === "ready" || connection.state === "offline"}
            watches={connection.capabilities.includes("watches")}
            reactions={connection.capabilities.includes("reactions")}
            me={connection.account?.username}
        />
    );
}

function Discussion({
    remoteOrigin,
    projectId,
    settled,
    watches,
    reactions,
    me,
}: ProjectDiscussionProps & { settled: boolean; watches: boolean; reactions: boolean; me: string | undefined }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    // Reactions arrive on the same threads topic, so reading them with the threads keeps one
    // refresh for both. A server that keeps none answers the threads alone.
    const read = useCallback(async (): Promise<TeamOutcome<DiscussionPage>> => {
        const page = await listThreads(remoteOrigin, projectId);
        if (!page.ok) return page;
        const targets = page.value.threads.flatMap(thread => (thread.opening ? [thread.opening.id] : []));
        if (!reactions || targets.length === 0) return { ok: true, value: { ...page.value, reactions: [] } };
        const given = await listReactions(remoteOrigin, { project: projectId, kind: "comment", targets });
        return { ok: true, value: { ...page.value, reactions: given.ok ? given.value : [] } };
    }, [remoteOrigin, projectId, reactions]);
    const topics = useMemo(() => [teamProjectThreadsTopic(projectId)], [projectId]);
    const { value, problem, refresh } = useTeamTopics(remoteOrigin, topics, read);

    // The last answer that worked, which stays on screen while the server is not
    // answering. What a reader is shown is what was true, plus a line saying it could not
    // be refreshed - never the empty state, which means something else entirely.
    const threads = value?.threads ?? [];
    const given = value?.reactions ?? [];
    // Said once the connection has settled either way, so that the moment between opening
    // a session and its first answer does not claim anything. A list that is on screen
    // stays on screen beside it: what was read was true, and it is only out of date.
    const unread = problem !== null && settled;

    const add = async (): Promise<void> => {
        const body = draft.trim();
        if (body === "" || busy) return;
        setBusy(true);
        setFailed(false);
        const written = await createThread(remoteOrigin, {
            project: projectId,
            // Nothing anchored: this is about the project rather than about a document
            // inside it. See the note at the top of this file.
            anchor: {},
            body,
            // Names this write, so the same note sent twice over a session that dropped
            // between the request and the answer is one note.
            clientId: crypto.randomUUID(),
        });
        setBusy(false);
        if (!written.ok) {
            setFailed(true);
            return;
        }
        setDraft("");
        // The server announces this on the topic as well, so this is usually the second
        // reason to redraw rather than the first. Asked anyway: the one case where the
        // announcement does not arrive is a subscription that has just been re-made, and
        // a note that only appears for other people is the worst way to find that out.
        refresh();
    };

    return (
        <section className="mt-4" data-project-discussion>
            <div className="flex items-center justify-between gap-2">
                <FieldLabel as="div">{t("launcher.servers.discussion.title")}</FieldLabel>
                {watches && <WatchButton remoteOrigin={remoteOrigin} projectId={projectId} />}
            </div>

            {!unread && threads.length === 0 && (
                <p className="text-xs text-fg-subtle">{t("launcher.servers.discussion.empty")}</p>
            )}

            {threads.length > 0 && (
                <ul className="space-y-1">
                    {threads.map(thread => (
                        <ThreadRow
                            key={thread.id}
                            remoteOrigin={remoteOrigin}
                            thread={thread}
                            onChanged={refresh}
                            reactions={
                                reactions && thread.opening
                                    ? given.filter(reaction => reaction.target === thread.opening?.id)
                                    : undefined
                            }
                            me={me}
                        />
                    ))}
                </ul>
            )}

            {unread && (
                <p className="mt-1 text-xs text-fg-subtle" data-discussion-unread>
                    {t("launcher.servers.discussion.unavailable")}
                </p>
            )}

            <div className="mt-2 flex items-center gap-2">
                <Input
                    size="sm"
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") void add();
                    }}
                    placeholder={t("launcher.servers.discussion.placeholder")}
                    data-discussion-field="body"
                />
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || draft.trim() === ""}
                    onClick={() => void add()}
                    data-discussion-action="add"
                >
                    {t("launcher.servers.discussion.add")}
                </Button>
            </div>

            {failed && (
                <p className="mt-1 text-xs text-danger">{t("launcher.servers.discussion.failed")}</p>
            )}
        </section>
    );
}

/**
 * One conversation.
 *
 * The opening comment is what a list of these shows, because it is what somebody wanted
 * said; the rest of a thread is read by opening it, which is a screen that does not exist
 * yet. A thread whose opening comment has been withdrawn draws an empty body rather than
 * a stand-in, which is the same bargain every absent field on this page makes.
 */
function ThreadRow({
    remoteOrigin,
    thread,
    onChanged,
    reactions,
    me,
}: {
    remoteOrigin: string;
    thread: TeamThread;
    onChanged: () => void;
    /** The opening comment's reactions; absent where the server keeps none. */
    reactions?: TeamReaction[];
    me: string | undefined;
}) {
    const { t, formatDate } = useTranslation();
    const [busy, setBusy] = useState(false);
    const day: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

    const settle = async (): Promise<void> => {
        if (busy) return;
        setBusy(true);
        await resolveThread(remoteOrigin, thread.id, thread.status === "open");
        setBusy(false);
        onChanged();
    };

    const said = [
        thread.createdBy,
        formatDate(thread.createdAt, day),
        thread.anchor.document,
        thread.status === "resolved" ? t("launcher.servers.discussion.resolved") : undefined,
    ].filter((part): part is string => part !== undefined && part !== "");

    return (
        <li
            className="flex items-start justify-between gap-2 rounded-md border border-edge px-3 py-2"
            data-discussion-thread={thread.id}
        >
            <div className="min-w-0">
                <p className="truncate text-xs text-fg">{thread.opening?.body ?? ""}</p>
                <p className="mt-0.5 truncate text-2xs text-fg-subtle">{said.join(" · ")}</p>
                {reactions !== undefined && thread.opening && (
                    <Reactions
                        remoteOrigin={remoteOrigin}
                        project={thread.project}
                        target={thread.opening.id}
                        reactions={reactions}
                        me={me}
                        onChanged={onChanged}
                    />
                )}
            </div>
            <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void settle()}
                data-discussion-action="settle"
            >
                {thread.status === "open"
                    ? t("launcher.servers.discussion.resolve")
                    : t("launcher.servers.discussion.reopen")}
            </Button>
        </li>
    );
}

/**
 * Following this project, so that a change to it is a notification.
 *
 * Only the project as a whole: following one scene is done beside the scene, in the web
 * console. Reads its state once and keeps what the server answers to each change.
 */
function WatchButton({ remoteOrigin, projectId }: { remoteOrigin: string; projectId: string }) {
    const { t } = useTranslation();
    const [watching, setWatching] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let live = true;
        void listWatches(remoteOrigin, projectId).then(answer => {
            if (live && answer.ok) setWatching(answer.value.some(watch => watch.scope === undefined));
        });
        return () => {
            live = false;
        };
    }, [remoteOrigin, projectId]);

    if (watching === null) return null;

    const flip = async (): Promise<void> => {
        if (busy) return;
        setBusy(true);
        const answer = await setWatch(remoteOrigin, { project: projectId, watching: !watching });
        setBusy(false);
        if (answer.ok) setWatching(answer.value.some(watch => watch.scope === undefined));
    };

    return (
        <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void flip()}
            title={t("launcher.servers.discussion.watchHint")}
            data-discussion-action="watch"
            data-watching={watching ? "true" : "false"}
        >
            {watching ? t("launcher.servers.discussion.watching") : t("launcher.servers.discussion.watch")}
        </Button>
    );
}

/**
 * The emoji on one comment, and a way to add one.
 *
 * Each given emoji is a button that gives or takes back the caller's own; the last button
 * opens the rest of the eight. The server announces every change on the threads topic, so
 * the list redraws from there as well as from the answer here.
 */
function Reactions({
    remoteOrigin,
    project,
    target,
    reactions,
    me,
    onChanged,
}: {
    remoteOrigin: string;
    project: string;
    target: string;
    reactions: TeamReaction[];
    me: string | undefined;
    onChanged: () => void;
}) {
    const { t } = useTranslation();
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);

    const give = async (emoji: TeamReactionEmoji): Promise<void> => {
        if (busy) return;
        setBusy(true);
        setPicking(false);
        await toggleReaction(remoteOrigin, { project, kind: "comment", target, emoji });
        setBusy(false);
        onChanged();
    };

    const shown = reactions.filter(reaction => reaction.by.length > 0);
    return (
        <div className="mt-1 flex flex-wrap items-center gap-1" data-discussion-reactions={target}>
            {shown.map(reaction => {
                const mine = me !== undefined && reaction.by.includes(me);
                return (
                    <button
                        key={reaction.emoji}
                        type="button"
                        disabled={busy}
                        onClick={() => void give(reaction.emoji)}
                        title={reaction.by.join(", ")}
                        aria-pressed={mine}
                        className={`rounded-full border px-1.5 text-2xs leading-5 ${
                            mine ? "border-primary bg-primary/10 text-fg" : "border-edge text-fg-subtle"
                        }`}
                    >
                        {reaction.emoji} {reaction.by.length}
                    </button>
                );
            })}
            {picking ? (
                TEAM_REACTIONS.map(emoji => (
                    <button
                        key={emoji}
                        type="button"
                        disabled={busy}
                        onClick={() => void give(emoji)}
                        className="rounded px-1 text-xs leading-5 hover:bg-fill"
                    >
                        {emoji}
                    </button>
                ))
            ) : (
                <button
                    type="button"
                    onClick={() => setPicking(true)}
                    title={t("launcher.servers.discussion.react")}
                    aria-label={t("launcher.servers.discussion.react")}
                    className="rounded-full border border-dashed border-edge px-1.5 text-2xs leading-5 text-fg-subtle"
                    data-discussion-action="react"
                >
                    +
                </button>
            )}
        </div>
    );
}
