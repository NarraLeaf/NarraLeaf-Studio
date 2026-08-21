/**
 * The Team protocol, as Studio speaks it.
 *
 * A server used to be a credential and an address: sign in, clone, push. Everything
 * Studio could ask it was one HTTPS request at a time, and everything it could learn was
 * whatever it thought to ask for. That is enough for a list of projects and it is enough
 * for nothing else - work somebody else did arrives when a person reopens a screen, and
 * there is nowhere below a project to attach anything to.
 *
 * So a server is now something Studio holds a **session** with. One connection per
 * server, authenticated once, over which either side speaks: Studio makes calls and
 * subscribes to topics, the server answers calls and pushes events. Everything a product
 * feature needs - reading, writing, and being told - is one shape rather than three.
 *
 * **This file is a twin.** Its other half is `src/team/protocol.ts` in the Team
 * repository. Two copies rather than a shared package, because the two release separately
 * and neither depends on the other; `team/conformance.test.ts` pins what both sides have
 * to agree about, so a change to one of them is a failing test rather than a bad
 * afternoon. Nothing in here may be changed without changing the other.
 *
 * Three rules that the rest of Studio's Team code follows from:
 *
 *  1. **A capability is checked, never probed.** A server says what it serves in its
 *     discovery document and again in the session's opening frame. Studio matches those
 *     names literally and asks for nothing it did not find one for. A screen for
 *     something a deployment does not offer is simply not drawn - see `teamCan`.
 *  2. **An anchor is Studio's, and the server never reads it.** A comment is attached to
 *     a document inside a project and usually to an element inside that document. Both
 *     are strings this side writes and this side interprets. That is what lets Studio
 *     start anchoring to a new kind of thing without a line changing on the server.
 *  3. **A missed event is recovered by reading again, not by replaying.** Every topic
 *     carries a sequence; a subscription is told where that sequence stands. Anything
 *     other than exactly the number last seen means read the collection again.
 */

/** Where the socket is, on the same TLS listener the discovery document arrives over. */
export const TEAM_SOCKET_PATH = "/api/team/v1/socket";

/** What the shapes in this file are, as a whole. Compared with the server's opening frame. */
export const TEAM_PROTOCOL_VERSION = 1;

/** The names a server announces, and Studio matches literally. */
export type TeamCapability =
    /** The session exists at all. Everything below implies it. */
    | "session"
    /** Threads and comments anchored in a project. */
    | "comments";

/* ------------------------------------------------------------------ frames */

/** Who is on the other end of a session. */
export interface TeamAccount {
    id: string;
    username: string;
    displayName: string;
    email?: string;
    /** Whether this account may administer the server. Not a permission over any project. */
    operator: boolean;
}

/** What a server says before anything is asked of it. */
export interface TeamHelloFrame {
    t: "hello";
    protocol: number;
    server: { name: string; version: string };
    session: string;
    account: TeamAccount;
    methods: string[];
    capabilities: TeamCapability[];
    serverTime: number;
    heartbeatMs: number;
}

export interface TeamResultFrame { t: "result"; id: number; value: unknown }
export interface TeamErrorFrame { t: "error"; id: number; code: TeamErrorCode; message: string }
export interface TeamSubscribedFrame { t: "subscribed"; id: number; topic: string; seq: number }
export interface TeamEventFrame { t: "event"; topic: string; seq: number; payload: unknown }
export interface TeamByeFrame { t: "bye"; code: TeamErrorCode; message: string }

export type TeamServerFrame =
    | TeamHelloFrame
    | TeamResultFrame
    | TeamErrorFrame
    | TeamSubscribedFrame
    | TeamEventFrame
    | TeamByeFrame;

/**
 * Every way a call can fail, as the server codes it.
 *
 * Coded rather than worded: the sentence an author reads is written in the renderer, in
 * their language. The message that comes with one of these is for the log.
 */
export type TeamErrorCode =
    | "unknown-method"
    | "bad-params"
    | "not-found"
    | "refused"
    | "conflict"
    | "unavailable"
    | "unauthenticated"
    | "internal";

/* ------------------------------------------------------------------ topics */

export const TEAM_TOPIC_PROJECTS = "projects";
export const TEAM_TOPIC_MEMBERS = "members";

/** One project's row, or what the server has read out of its repository. */
export function teamProjectTopic(projectId: string): string {
    return `project:${projectId}`;
}

/** The threads anchored anywhere in one project. */
export function teamProjectThreadsTopic(projectId: string): string {
    return `project:${projectId}/threads`;
}

/* ----------------------------------------------------------------- anchors */

/**
 * Where in a project something is attached.
 *
 * `document` is a path inside the project as Studio writes it, `element` is Studio's id
 * for something inside that document - a story row, a blueprint node, whatever comes
 * next - and `revision` is what the repository was at when it was written, which is what
 * says a comment may be pointing at something that has since changed.
 *
 * The server stores all three, indexes on the first two and reads none of them.
 */
export interface TeamAnchor {
    /**
     * Which document inside the project, and absent for one about the project itself.
     *
     * Absent is a real case rather than a gap: a note about the project as a whole is the
     * first thing anybody has to say about one, and a path invented to stand for it would
     * be a string every screen had to learn not to show.
     */
    document?: string;
    element?: string;
    revision?: string;
}

/* --------------------------------------------------------- what calls answer */

export type TeamThreadKind = "comment" | "suggestion";
export type TeamThreadStatus = "open" | "resolved";

/** A conversation attached to one anchor. */
export interface TeamThread {
    id: string;
    project: string;
    anchor: TeamAnchor;
    kind: TeamThreadKind;
    status: TeamThreadStatus;
    /**
     * Who opened it, by username, and absent for an account the server no longer has.
     *
     * A name rather than an id, for the reason the project list carries one. Absent
     * rather than a stand-in: a thread outlives the account that opened it, and a row
     * claiming an author it cannot name would be worse than one that claims none.
     */
    createdBy?: string;
    createdAt: number;
    updatedAt: number;
    /** Who settled it, by username. */
    resolvedBy?: string;
    resolvedAt?: number;
    /** How many comments it holds, withdrawn ones included. */
    comments: number;
    /** The first comment, which is what a list of threads shows. */
    opening?: TeamComment;
}

/** One thing somebody said. */
export interface TeamComment {
    id: string;
    thread: string;
    /** Who wrote it, by username. Absent for the same reason {@link TeamThread.createdBy} is. */
    author?: string;
    body: string;
    /**
     * What this comment proposes, as Studio encoded it.
     *
     * Opaque to the server, which is the point: what a suggestion replaces and how is a
     * question about a document, and the server does not have one.
     */
    suggestion?: string;
    createdAt: number;
    editedAt?: number;
    /** When it was withdrawn. The row stays so that the shape of the conversation does. */
    deletedAt?: number;
}

/** What arrives on a project's threads topic. */
export type TeamThreadEvent =
    | { kind: "thread-created"; thread: TeamThread }
    | { kind: "thread-updated"; thread: TeamThread }
    | { kind: "comment-created"; thread: string; comment: TeamComment }
    | { kind: "comment-updated"; thread: string; comment: TeamComment };

/** What arrives on the projects topic. */
export type TeamProjectsEvent =
    | { kind: "project-created"; project: string }
    | { kind: "project-forgotten"; project: string }
    | { kind: "project-read"; project: string };

/* ------------------------------------------------------------ method names */

/**
 * Every method, by the name it is called with.
 *
 * Written out rather than typed as a bare string wherever it is used, so that a rename on
 * the server is one failing import here rather than a call that is refused at runtime on
 * somebody else's machine.
 */
export const TeamMethod = {
    projectsList: "projects.list",
    projectsGet: "projects.get",
    membersList: "members.list",
    threadsList: "threads.list",
    threadsGet: "threads.get",
    threadsCreate: "threads.create",
    threadsReply: "threads.reply",
    threadsResolve: "threads.resolve",
    commentsEdit: "comments.edit",
    commentsDelete: "comments.delete",
} as const;

export type TeamMethodName = (typeof TeamMethod)[keyof typeof TeamMethod];

/* ------------------------------------------------- what crosses to the renderer */

/**
 * Why a call did not produce an answer.
 *
 * The first four are Studio's own answers and never reached the server; the last is the
 * server's, carried through with its code so the renderer can say the one sentence that
 * fits. Keeping them in one union is what lets every caller have one failure path.
 */
export type TeamProblem =
    /** Studio has no record of that server. Nothing was attempted. */
    | { kind: "no-server" }
    /**
     * This installation cannot produce the token for that server.
     *
     * Not "signed out": the session record is there and the repositories still open. It
     * means the sealed token cannot be read - a machine whose keyring is unavailable, or
     * one that added the server before Studio kept tokens. The way out is to add the
     * server again with its token.
     */
    | { kind: "no-token" }
    /** Not connected at the moment. The detail is why, for a log rather than a screen. */
    | { kind: "offline"; detail: string }
    /** That server does not offer this. Checked rather than attempted. */
    | { kind: "unsupported" }
    /** The server answered, and its answer was no. */
    | { kind: "refused"; code: TeamErrorCode; detail: string };

export type TeamCallOutcome =
    | { ok: true; value: unknown }
    | { ok: false; problem: TeamProblem };

export type TeamSubscribeOutcome =
    | { ok: true; seq: number }
    | { ok: false; problem: TeamProblem };

/** Where one server's session stands. */
export interface TeamConnection {
    remoteOrigin: string;
    /**
     * What is happening now.
     *
     * `idle` is the state before anything asked for this server - Studio does not open a
     * session for every server it knows about, only for one a screen is showing.
     */
    state: "idle" | "connecting" | "ready" | "offline";
    capabilities: TeamCapability[];
    account?: TeamAccount;
    /** What the server called itself in its opening frame. */
    serverName?: string;
    serverVersion?: string;
    /** Why it is not ready, in English, for a log. Absent while it is. */
    detail?: string;
    /** When this state began. Epoch ms. */
    since: number;
}

/** One event, as it reaches a window. */
export interface TeamEventMessage {
    remoteOrigin: string;
    topic: string;
    seq: number;
    payload: unknown;
}
