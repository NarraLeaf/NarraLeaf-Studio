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
    type TeamClientInstance,
    type TeamComment,
    type TeamLiveMember,
    type TeamLiveMessage,
    type TeamLiveSession,
    type TeamOverlayRecord,
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

/* ----------------------------------------------------------- client instances */

/** One installation, or null because what arrived was not one. */
export function readClientInstance(value: unknown): TeamClientInstance | null {
    const from = record(value);
    if (from === null) return null;
    const id = text(from, "id");
    const account = text(from, "account");
    if (id === undefined || account === undefined) return null;
    const project = text(from, "project");
    const revision = text(from, "revision");
    return {
        id,
        account,
        // Never empty on the wire, but a row in a list of who is here with an empty name
        // column is worse than a generic one.
        label: text(from, "label") ?? account,
        agent: text(from, "agent") ?? "",
        ...(project === undefined ? {} : { project }),
        ...(revision === undefined ? {} : { revision }),
        since: count(from, "since") ?? 0,
    };
}

/**
 * Say that this window is here, and what it has open.
 *
 * **The identity is not stated here.** This names the project and the revision; the main
 * process fills in which installation this is, what it is called and which build - see
 * `TeamClient.stated`. It is also what makes the announcement survive a reconnect, since
 * presence lives in the server's memory and dies with the socket.
 *
 * Called again whenever what this window has open changes. Announcing twice is ordinary.
 */
export async function announceClient(
    remoteOrigin: string,
    what: { project?: string; revision?: string } = {},
): Promise<TeamOutcome<TeamClientInstance>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.clientsAnnounce, what);
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const client = from === null ? null : readClientInstance(from["client"]);
    return client === null ? unreadable() : { ok: true, value: client };
}

/**
 * Take this window's presence back, because it is closing.
 *
 * Needed because the socket outlives the window: Studio holds one session per server and
 * a window per project, so a closed project would otherwise leave somebody's name against
 * it until the whole of Studio quit.
 */
export async function withdrawClient(
    remoteOrigin: string,
    project: string,
): Promise<TeamOutcome<null>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.clientsWithdraw, { project });
    return answered.ok ? { ok: true, value: null } : answered;
}

/** Which installations are connected, narrowed to those with one project open. */
export async function listClients(
    remoteOrigin: string,
    project?: string,
): Promise<TeamOutcome<TeamClientInstance[]>> {
    const answered = await teamCall(
        remoteOrigin,
        TeamMethod.clientsList,
        project === undefined ? {} : { project },
    );
    if (!answered.ok) return answered;
    const clients = readList(answered.value, "clients", readClientInstance);
    return clients === null ? unreadable() : { ok: true, value: clients };
}

/* -------------------------------------------------------------- live sessions */

function readLiveMember(value: unknown): TeamLiveMember | null {
    const from = record(value);
    if (from === null) return null;
    const instance = text(from, "instance");
    const account = text(from, "account");
    if (instance === undefined || account === undefined) return null;
    return {
        instance,
        account,
        label: text(from, "label") ?? account,
        joinedAt: count(from, "joinedAt") ?? 0,
    };
}

/** One room, or null. */
export function readLiveSession(value: unknown): TeamLiveSession | null {
    const from = record(value);
    if (from === null) return null;
    const id = text(from, "id");
    const project = text(from, "project");
    const openedBy = text(from, "openedBy");
    const openedByInstance = text(from, "openedByInstance");
    if (
        id === undefined || project === undefined ||
        openedBy === undefined || openedByInstance === undefined
    ) {
        return null;
    }
    const revision = text(from, "revision");
    const story = text(from, "story");
    const title = text(from, "title");
    const members = Array.isArray(from["members"])
        ? from["members"].map(readLiveMember).filter((one): one is TeamLiveMember => one !== null)
        : [];
    return {
        id,
        project,
        ...(revision === undefined ? {} : { revision }),
        ...(story === undefined ? {} : { story }),
        ...(title === undefined ? {} : { title }),
        openedBy,
        openedByInstance,
        openedAt: count(from, "openedAt") ?? 0,
        members,
    };
}

/** One thing said in a room, as it arrives on that room's topic. */
export function readLiveMessage(value: unknown): TeamLiveMessage | null {
    const from = record(value);
    if (from === null) return null;
    const session = text(from, "session");
    const sender = text(from, "from");
    if (session === undefined || sender === undefined) return null;
    return {
        session,
        from: sender,
        account: text(from, "account") ?? "",
        at: count(from, "at") ?? 0,
        // Carried whole and unread, which is what it is on the server too.
        payload: from["payload"],
    };
}

/** The rooms open on one project. */
export async function listLiveSessions(
    remoteOrigin: string,
    project: string,
): Promise<TeamOutcome<TeamLiveSession[]>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.liveList, { project });
    if (!answered.ok) return answered;
    const sessions = readList(answered.value, "sessions", readLiveSession);
    return sessions === null ? unreadable() : { ok: true, value: sessions };
}

/**
 * Open a room on this project, with this window already in it.
 *
 * The one act here somebody deliberately performs. Everything else about a Team server
 * happens because a window opened; this happens because a person decided to work on
 * something with somebody else.
 */
export async function openLiveSession(
    remoteOrigin: string,
    input: { project: string; revision: string; story: string; title?: string },
): Promise<TeamOutcome<TeamLiveSession>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.liveOpen, input);
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const session = from === null ? null : readLiveSession(from["session"]);
    return session === null ? unreadable() : { ok: true, value: session };
}

/** Join one somebody else opened. Joining one this window is already in is not an error. */
export async function joinLiveSession(
    remoteOrigin: string,
    session: string,
): Promise<TeamOutcome<TeamLiveSession>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.liveJoin, { session });
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const read = from === null ? null : readLiveSession(from["session"]);
    return read === null ? unreadable() : { ok: true, value: read };
}

/** Leave one. The last one out closes it. Never refused, including for a room that is gone. */
export async function leaveLiveSession(
    remoteOrigin: string,
    session: string,
): Promise<TeamOutcome<null>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.liveLeave, { session });
    return answered.ok ? { ok: true, value: null } : answered;
}

/** Close one outright, which only the window that opened it may do. */
export async function closeLiveSession(
    remoteOrigin: string,
    session: string,
): Promise<TeamOutcome<null>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.liveClose, { session });
    return answered.ok ? { ok: true, value: null } : answered;
}

/**
 * Say something to everybody in a room.
 *
 * `payload` is Studio's own and the server never reads it - this is the path a real-time
 * feature will send its operations down. **Nothing said this way is kept**: it reaches
 * whoever is subscribed at that instant and is forgotten, so anything that has to survive
 * goes through {@link putOverlay} or into the repository.
 */
export async function sayInLiveSession(
    remoteOrigin: string,
    session: string,
    payload: unknown,
): Promise<TeamOutcome<null>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.liveSay, { session, payload });
    return answered.ok ? { ok: true, value: null } : answered;
}

/* -------------------------------------------------------------------- overlay */

/** One record, or null. */
export function readOverlayRecord(value: unknown): TeamOverlayRecord | null {
    const from = record(value);
    if (from === null) return null;
    const id = text(from, "id");
    const project = text(from, "project");
    const anchorOf = record(from["anchor"]);
    const kind = text(from, "kind");
    if (id === undefined || project === undefined || anchorOf === null || kind === undefined) {
        return null;
    }
    const revision = text(anchorOf, "revision");
    // A record with no revision is one this build cannot age, which is the only thing a
    // record is for. Dropped rather than drawn as though it were current.
    if (revision === undefined) return null;
    const document = text(anchorOf, "document");
    const element = text(anchorOf, "element");
    const author = text(from, "author");
    const instance = text(from, "instance");
    return {
        id,
        project,
        anchor: {
            ...(document === undefined ? {} : { document }),
            ...(element === undefined ? {} : { element }),
            revision,
        },
        kind,
        body: typeof from["body"] === "string" ? from["body"] : "",
        ...(author === undefined ? {} : { author }),
        ...(instance === undefined ? {} : { instance }),
        createdAt: count(from, "createdAt") ?? 0,
        updatedAt: count(from, "updatedAt") ?? 0,
    };
}

/** What one read of a project's overlay found. */
export interface OverlayReading {
    records: TeamOverlayRecord[];
    /**
     * What the server last read this project's tip to be, absent because it has not.
     *
     * ⚠ **Absent is "not read yet", never "there are no revisions".** The server reads
     * repositories on a loop, so a project it has not reached has no head - and a screen
     * that treated that as "everything is stale" would say so for a minute after every
     * server restart. Compare only when this is there.
     */
    head?: string;
    /** How many records the whole project holds, whatever this read narrowed to. */
    total: number;
}

/**
 * What is attached to a project, and what the server thinks it stands at.
 *
 * **The comparison is Studio's.** The server hands back the revision each record was
 * written against and the head it last read, and makes no judgement - only this side is
 * holding the documents, so only this side can say whether the thing a record is about
 * survived. See {@link overlayIsStale}.
 */
export async function listOverlay(
    remoteOrigin: string,
    project: string,
    within: { document?: string; element?: string; kind?: string; revision?: string; limit?: number } = {},
): Promise<TeamOutcome<OverlayReading>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.overlayList, { project, ...within });
    if (!answered.ok) return answered;
    const records = readList(answered.value, "records", readOverlayRecord);
    const from = record(answered.value);
    if (records === null || from === null) return unreadable();
    const head = text(from, "head");
    return {
        ok: true,
        value: { records, ...(head === undefined ? {} : { head }), total: count(from, "total") ?? records.length },
    };
}

/**
 * Whether a record is about a version that is no longer the current one.
 *
 * False where the head is unknown, which is the whole reason this is a function rather
 * than a comparison written out at each call site: `record.anchor.revision !== head` is
 * true when `head` is undefined, and that one expression would mark everything stale
 * every time the server restarted.
 */
export function overlayIsStale(record: TeamOverlayRecord, head: string | undefined): boolean {
    return head !== undefined && record.anchor.revision !== head;
}

/**
 * Attach something to a project at a revision, or replace something already attached.
 *
 * Pass `id` to replace - which is also how a record is moved forward onto a new head,
 * after this side has looked and found what it is about still there. The place cannot
 * move: a record that changed which element it was about would be a different record.
 *
 * `clientId` names the write, so that a retry after a session dropped between the request
 * and its answer is the same row rather than a second one.
 */
export async function putOverlay(
    remoteOrigin: string,
    input: {
        project?: string;
        id?: string;
        anchor: { document?: string; element?: string; revision: string };
        kind?: string;
        body: string;
        clientId?: string;
    },
): Promise<TeamOutcome<TeamOverlayRecord>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.overlayPut, input);
    if (!answered.ok) return answered;
    const from = record(answered.value);
    const written = from === null ? null : readOverlayRecord(from["record"]);
    return written === null ? unreadable() : { ok: true, value: written };
}

/** Take one's own record off. Never refused for one that is already gone. */
export async function dropOverlay(
    remoteOrigin: string,
    id: string,
): Promise<TeamOutcome<null>> {
    const answered = await teamCall(remoteOrigin, TeamMethod.overlayDrop, { id });
    return answered.ok ? { ok: true, value: null } : answered;
}
