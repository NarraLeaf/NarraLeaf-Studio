/**
 * Every question Studio asks a Team server, typed once.
 *
 * The bridge carries a method name and an unknown payload, because that is what keeps the
 * IPC surface at five members while the protocol grows. This is where that is paid back:
 * each call below names its method, states what it takes and what it answers, and reads
 * the answer defensively. A screen calls `team.listThreads(server, project)` and gets
 * threads or a problem; it never types a method name and never casts a payload.
 *
 * **Every answer is read rather than trusted.** What comes back crossed a network from a
 * server that may be newer or older than this build, and a field it did not send must not
 * become `undefined` halfway through drawing a list. So a shape that does not read is a
 * problem, in the same union as a refusal - one failure path per caller, which is the
 * whole reason the outcome type exists.
 */
import { getInterface } from "@/lib/app/bridge";
import {
    TeamMethod,
    type TeamAnchor,
    type TeamComment,
    type TeamProblem,
    type TeamThread,
    type TeamThreadKind,
    type TeamThreadStatus,
} from "@shared/types/team";
import type { VcsServerMember, VcsServerProject } from "@shared/types/vcs";

/** What any of these answers with. */
export type TeamOutcome<T> = { ok: true; value: T } | { ok: false; problem: TeamProblem };

/** A shape the server sent that this build cannot read. */
function unreadable<T>(): TeamOutcome<T> {
    return { ok: false, problem: { kind: "refused", code: "internal", detail: "unreadable answer" } };
}

/**
 * Make one call and hand back what it answered, unread.
 *
 * Exported because a screen for something this file has not caught up with is better than
 * a screen that waits for it - but everything ordinary should go through the named calls
 * below, where the shapes live.
 */
export async function teamCall(
    remoteOrigin: string,
    method: string,
    params?: unknown,
): Promise<TeamOutcome<unknown>> {
    const answered = await getInterface().team.call(remoteOrigin, method, params).catch(() => null);
    if (answered === null || !answered.success) {
        // The bridge itself did not answer. Nothing reached the server, so this is the
        // same thing as having no session with it.
        return { ok: false, problem: { kind: "offline", detail: "the bridge did not answer" } };
    }
    return answered.data.ok
        ? { ok: true, value: answered.data.value }
        : { ok: false, problem: answered.data.problem };
}

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function text(from: Record<string, unknown>, key: string): string | undefined {
    const value = from[key];
    return typeof value === "string" && value !== "" ? value : undefined;
}

function count(from: Record<string, unknown>, key: string): number | undefined {
    const value = from[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** One comment, or null because what arrived was not one. */
function readComment(value: unknown): TeamComment | null {
    const from = record(value);
    if (from === null) return null;
    const id = text(from, "id");
    const thread = text(from, "thread");
    const createdAt = count(from, "createdAt");
    if (id === undefined || thread === undefined || createdAt === undefined) {
        return null;
    }
    // Absent where the server no longer has that account, which is a comment with no
    // name against it rather than one to drop.
    const author = text(from, "author");
    const suggestion = text(from, "suggestion");
    const editedAt = count(from, "editedAt");
    const deletedAt = count(from, "deletedAt");
    return {
        id,
        thread,
        ...(author === undefined ? {} : { author }),
        // A withdrawn comment has an empty body on purpose, so this one field is read
        // without insisting it is non-empty.
        body: typeof from["body"] === "string" ? from["body"] : "",
        ...(suggestion === undefined ? {} : { suggestion }),
        createdAt,
        ...(editedAt === undefined ? {} : { editedAt }),
        ...(deletedAt === undefined ? {} : { deletedAt }),
    };
}

/** One thread, or null. */
export function readThread(value: unknown): TeamThread | null {
    const from = record(value);
    if (from === null) return null;
    const id = text(from, "id");
    const project = text(from, "project");
    const anchorOf = record(from["anchor"]);
    const createdBy = text(from, "createdBy");
    const createdAt = count(from, "createdAt");
    const updatedAt = count(from, "updatedAt");
    if (
        id === undefined || project === undefined || anchorOf === null ||
        createdAt === undefined || updatedAt === undefined
    ) {
        return null;
    }
    const document = text(anchorOf, "document");
    const element = text(anchorOf, "element");
    const revision = text(anchorOf, "revision");
    const anchor: TeamAnchor = {
        ...(document === undefined ? {} : { document }),
        ...(element === undefined ? {} : { element }),
        ...(revision === undefined ? {} : { revision }),
    };
    const opening = readComment(from["opening"]);
    const resolvedBy = text(from, "resolvedBy");
    const resolvedAt = count(from, "resolvedAt");
    return {
        id,
        project,
        anchor,
        kind: from["kind"] === "suggestion" ? "suggestion" : "comment",
        status: from["status"] === "resolved" ? "resolved" : "open",
        ...(createdBy === undefined ? {} : { createdBy }),
        createdAt,
        updatedAt,
        ...(resolvedBy === undefined ? {} : { resolvedBy }),
        ...(resolvedAt === undefined ? {} : { resolvedAt }),
        comments: count(from, "comments") ?? 0,
        ...(opening === null ? {} : { opening }),
    };
}

/** Read a list, dropping anything in it that does not read rather than failing the lot. */
function readList<T>(value: unknown, key: string, one: (item: unknown) => T | null): T[] | null {
    const from = record(value);
    if (from === null) return null;
    const items = from[key];
    if (!Array.isArray(items)) return null;
    return items.map(one).filter((item): item is T => item !== null);
}

/* -------------------------------------------------------------------- projects */

/** Every project on a server, over the session rather than over the REST route. */
export async function listProjects(remoteOrigin: string): Promise<TeamOutcome<VcsServerProject[]>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.projectsList);
    if (!answered.ok) return answered;
    const projects = readList(answered.value, "projects", (item) => {
        const from = record(item);
        if (from === null) return null;
        const id = text(from, "id");
        const name = text(from, "name");
        const remote = text(from, "remote");
        if (id === undefined || name === undefined || remote === undefined) return null;
        const createdBy = text(from, "createdBy");
        const history = record(from["history"]);
        return {
            id,
            name,
            description: typeof from["description"] === "string" ? from["description"] : "",
            ...(createdBy === undefined ? {} : { createdBy }),
            createdAt: count(from, "createdAt") ?? 0,
            remote,
            // Carried as it arrived, absences included: a field the server left out is a
            // repository it has not read, which is not the same as a nought.
            ...(history === null ? {} : { history: history as VcsServerProject["history"] }),
        } satisfies VcsServerProject;
    });
    return projects === null ? unreadable() : { ok: true, value: projects };
}

/** Every account on a server, as a name beside a piece of work. */
export async function listMembers(remoteOrigin: string): Promise<TeamOutcome<VcsServerMember[]>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.membersList);
    if (!answered.ok) return answered;
    const members = readList(answered.value, "members", (item) => {
        const from = record(item);
        if (from === null) return null;
        const username = text(from, "username");
        if (username === undefined) return null;
        const createdAt = count(from, "createdAt");
        return {
            username,
            displayName: text(from, "displayName") ?? username,
            // "" rather than absent, because that is the shape this list already has:
            // an account the server holds no address for is one with nothing to draw.
            email: text(from, "email") ?? "",
            operator: from["operator"] === true,
            disabled: from["disabled"] === true,
            serviceAccount: from["serviceAccount"] === true,
            ...(createdAt === undefined ? {} : { createdAt }),
        } satisfies VcsServerMember;
    });
    return members === null ? unreadable() : { ok: true, value: members };
}

/* ---------------------------------------------------------------- conversations */

export interface ThreadPage {
    threads: TeamThread[];
    /** Where to carry on from, absent at the end. Opaque; hand it back as it came. */
    cursor?: string;
}

/**
 * The conversations in a project, newest activity first.
 *
 * Narrowed to a document, or to one thing inside a document, by passing the same strings
 * that were anchored with. The server compares them and reads neither.
 */
export async function listThreads(
    remoteOrigin: string,
    project: string,
    within: { document?: string; element?: string; status?: TeamThreadStatus; limit?: number; before?: string } = {},
): Promise<TeamOutcome<ThreadPage>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.threadsList, { project, ...within });
    if (!answered.ok) return answered;
    const threads = readList(answered.value, "threads", readThread);
    if (threads === null) return unreadable();
    const cursor = record(answered.value) === null ? undefined : text(record(answered.value) as Record<string, unknown>, "cursor");
    return { ok: true, value: { threads, ...(cursor === undefined ? {} : { cursor }) } };
}

/** One thread and everything in it. */
export async function getThread(
    remoteOrigin: string,
    thread: string,
): Promise<TeamOutcome<{ thread: TeamThread; comments: TeamComment[] }>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.threadsGet, { thread });
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const read = from === null ? null : readThread(from["thread"]);
    const comments = readList(answered.value, "comments", readComment);
    if (read === null || comments === null) return unreadable();
    return { ok: true, value: { thread: read, comments } };
}

/** Open a conversation on an anchor, with the comment that starts it. */
export async function createThread(
    remoteOrigin: string,
    input: {
        project: string;
        anchor: TeamAnchor;
        body: string;
        kind?: TeamThreadKind;
        suggestion?: string;
        /** Names this write, so a retry after a dropped session is not a second thread. */
        clientId?: string;
    },
): Promise<TeamOutcome<TeamThread>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.threadsCreate, input);
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const thread = from === null ? null : readThread(from["thread"]);
    return thread === null ? unreadable() : { ok: true, value: thread };
}

/** Add to a conversation. */
export async function replyToThread(
    remoteOrigin: string,
    input: { thread: string; body: string; suggestion?: string; clientId?: string },
): Promise<TeamOutcome<TeamComment>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.threadsReply, input);
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const comment = from === null ? null : readComment(from["comment"]);
    return comment === null ? unreadable() : { ok: true, value: comment };
}

/** Mark a conversation settled, or open it again. */
export async function resolveThread(
    remoteOrigin: string,
    thread: string,
    resolved: boolean,
): Promise<TeamOutcome<TeamThread>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.threadsResolve, { thread, resolved });
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const read = from === null ? null : readThread(from["thread"]);
    return read === null ? unreadable() : { ok: true, value: read };
}

/** Change the wording of one's own comment. Refused for anybody else's. */
export async function editComment(
    remoteOrigin: string,
    input: { comment: string; body: string; suggestion?: string },
): Promise<TeamOutcome<TeamComment>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.commentsEdit, input);
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const comment = from === null ? null : readComment(from["comment"]);
    return comment === null ? unreadable() : { ok: true, value: comment };
}

/** Withdraw one's own comment. The row stays, so the conversation keeps its shape. */
export async function deleteComment(
    remoteOrigin: string,
    comment: string,
): Promise<TeamOutcome<TeamComment>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.commentsDelete, { comment });
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const read = from === null ? null : readComment(from["comment"]);
    return read === null ? unreadable() : { ok: true, value: read };
}
