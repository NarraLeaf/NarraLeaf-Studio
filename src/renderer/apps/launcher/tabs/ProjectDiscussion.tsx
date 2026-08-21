import React, { useCallback, useMemo, useState } from "react";

import { Button, FieldLabel, Input } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import {
    createThread,
    listThreads,
    resolveThread,
    useTeamConnection,
    useTeamTopics,
    type TeamOutcome,
    type ThreadPage,
} from "@/lib/team";
import { teamProjectThreadsTopic, type TeamThread } from "@shared/types/team";

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
    if (!connection.capabilities.includes("comments")) {
        return null;
    }
    return <Discussion remoteOrigin={remoteOrigin} projectId={projectId} />;
}

function Discussion({ remoteOrigin, projectId }: ProjectDiscussionProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    const read = useCallback(
        (): Promise<TeamOutcome<ThreadPage>> => listThreads(remoteOrigin, projectId),
        [remoteOrigin, projectId],
    );
    const topics = useMemo(() => [teamProjectThreadsTopic(projectId)], [projectId]);
    const { value, refresh } = useTeamTopics(remoteOrigin, topics, read);

    const threads = value?.ok === true ? value.value.threads : [];

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
            <FieldLabel as="div">{t("launcher.servers.discussion.title")}</FieldLabel>

            {threads.length === 0 && (
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
                        />
                    ))}
                </ul>
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
}: {
    remoteOrigin: string;
    thread: TeamThread;
    onChanged: () => void;
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
