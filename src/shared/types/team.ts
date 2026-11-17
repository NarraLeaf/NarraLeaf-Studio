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
 * **The names in here are not authored in here.** The frame catalogue, the method names,
 * the capability vocabulary, the error codes, the topic patterns and the limits live once,
 * in the Team repository's zero-dependency `@narraleaf/team-protocol` package, which
 * generates `protocol/contract.json` out of itself. `teamContract.json` beside this file is
 * a copy of that generated artifact, and `teamContract.test.ts` pins every constant below
 * to it - so a name that moved on the server and not here is a failing test rather than a
 * call refused on somebody's machine. What this file adds is the shape Studio reads the
 * answers into, which is Studio's own and nobody else's business.
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

/**
 * Where a server keeps the account's Studio settings document (`studio-config`): GET reads it, PUT
 * replaces it. Read and written by the main process with the account's token, never by a window.
 */
export const TEAM_STUDIO_CONFIG_PATH = "/api/team/v1/studio-config";

/** The largest settings document a server keeps. */
export const TEAM_STUDIO_CONFIG_MAX_BYTES = 1024 * 1024;

/** What the shapes in this file are, as a whole. Compared with the server's opening frame. */
export const TEAM_PROTOCOL_VERSION = 2;

/**
 * The names a server announces, and Studio matches literally.
 *
 * **One vocabulary, said in two places.** A server advertises these same names in its
 * discovery document and again in the session's opening frame, so this is also the set the
 * version-control side gates on - {@link VcsServerCapability} is this type. There is not a
 * second list for the REST surface: a deployment offers a thing or it does not, and it says
 * so once.
 *
 * **Two different things are called a session in this file and it is worth being clear
 * once.** A *link session* is the socket: one per server, opened by Studio on its own the
 * moment a screen needs that server, and never seen by anybody. A *live session* is a
 * room somebody opens on a project so that the machines working on it together can be
 * found and spoken to. The first is `session`; the second is `live`.
 */
export type TeamCapability =
    /** The link session exists at all. Everything below implies it. */
    | "session"
    /** Studio may sign in through the browser (OAuth); see `vcs/serverOAuth.ts`. */
    | "oauth"
    /** Timelines and contribution graphs. */
    | "activity"
    /** To-dos, private or a project's, assignable and anchorable to a line or node. */
    | "todos"
    /** Mentions, replies and assignments, kept until read. */
    | "notifications"
    /** Asking a member to review a range of versions, and their verdict. */
    | "reviews"
    /** Names on revisions that a project can be read at. */
    | "milestones"
    /** Operators may have the server post its events elsewhere. */
    | "webhooks"
    /** Threads and comments anchored in a project. */
    | "comments"
    /** A project's own chat channel, kept on the server. */
    | "chat"
    /** Which installations are connected, and what each has open. */
    | "clients"
    /** Live sessions: rooms on a project, for finding installations and broadcasting to them. */
    | "live"
    /** Data attached to a project at a revision, which never enters the repository. */
    | "overlay"
    /**
     * This server's own state may be read and changed over the socket: its accounts, its
     * settings, its signing keys, the decisions it has made and how it is faring.
     *
     * **A statement about the build, not about the caller**, which is easier to misread
     * here than anywhere else on this list. Every server that has it announces it to
     * everybody and refuses the methods behind it to all but an operator, so whether the
     * account on this end may use it is {@link TeamAccount.operator} - a management screen
     * needs both, and Studio draws none yet.
     */
    | "admin"
    /** Mints a token from a username and password, rather than only accepting a pasted one. */
    | "password-sign-in"
    /** Answers a project's recent revisions. */
    | "project-history"
    /**
     * Carries the bytes of a file between the machines in a live session.
     *
     * ⚠ **Not every deployment has it**, and the difference is not cosmetic: a server
     * without it answers 404 to the transfer endpoints, so importing an asset during a
     * session against one is a file that never arrives.
     */
    | "blobs"
    /**
     * The server is the authority over a team project's documents: every edit is an intent
     * (`doc.intent`) the server applies and publishes on the project's `doc` topic, and the
     * history versions are snapshots it commits. Opening a team project on such a server is
     * following that topic - there is no room to open or join.
     */
    | "documents"
    /** Where each scene and asset stands - draft, waiting, approved or sent back. Team's record only. */
    | "approvals"
    /** An asset held by one person for a while; the server refuses edits to it from anybody else. */
    | "locks"
    /** Playable builds kept beside a project, uploaded over HTTP to `/api/team/v1/projects/{project}/builds`. */
    | "builds"
    /** Pictures put beside a comment, uploaded to `/api/team/v1/projects/{project}/attachments`. */
    | "attachments"
    /** Read-only links for somebody without an account. */
    | "shares"
    /** A daily or weekly letter of what is unread, and a person's own Feishu or Slack address. */
    | "digests"
    /** Browser push notifications (Web Push) for the web console. */
    | "push"
    /** Following a project or one scene, to be told when it changes. */
    | "watches"
    /** An emoji on a comment or a chat message. */
    | "reactions"
    /** A project's glossary: terms and how each language says them, kept by Team for translators. */
    | "glossary"
    /** Which voiced lines are recorded, and which need another take, per language. Team state only. */
    | "voice"
    /** Project templates: members, milestones and to-dos to start a project with, or to add to one. */
    | "templates"
    /** Accounts may sign in with a code from an authenticator app as well; set up in the web console. */
    | "two-factor"
    /** Personal access tokens an account mints for itself, for scripts and tools. */
    | "api-tokens"
    /** A project can be archived: read-only and out of the lists, until it is restored. */
    | "archive"
    /** How much space each project's files take, against a quota the operator sets. */
    | "storage"
    /** An operator can fix an account's settings, by template or one by one; the account reads what is fixed. */
    | "account-policy"
    /** The server keeps one copy of an account's Studio settings, for a new computer to restore. */
    | "studio-config";

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

/**
 * What an account says about itself, as `account.profile.get` answers.
 *
 * `avatarUrl` is a path on the server (`/api/team/v1/avatars/{username}/{sha256}.{ext}`), served
 * only to a signed-in caller - a renderer reads it through `team.avatar`, never directly.
 */
export interface TeamAccountProfile {
    username: string;
    displayName: string;
    /** A line the account wrote about itself. Absent where it wrote none. */
    bio?: string;
    avatarUrl?: string;
    /** An IANA time zone the account chose, for showing its local time. Absent where unset. */
    timezone?: string;
    /** Whether it has a session open now. Absent on servers that do not say. */
    online?: boolean;
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

/** One project's row, or what the server has read out of its repository. */
export function teamProjectTopic(projectId: string): string {
    return `project:${projectId}`;
}

/** The threads anchored anywhere in one project. */
export function teamProjectThreadsTopic(projectId: string): string {
    return `project:${projectId}/threads`;
}

/** What is attached to one project without being in its repository. */
export function teamProjectOverlayTopic(projectId: string): string {
    return `project:${projectId}/overlay`;
}

/** Which installations have one project open. */
export function teamProjectClientsTopic(projectId: string): string {
    return `project:${projectId}/clients`;
}

/** The live sessions open on one project. */
export function teamProjectLiveTopic(projectId: string): string {
    return `project:${projectId}/live`;
}

/** Who belongs to one project, and in which role. */
export function teamProjectMembersTopic(projectId: string): string {
    return `project:${projectId}/members`;
}

/** The to-dos shown to one project's members. */
export function teamProjectTodosTopic(projectId: string): string {
    return `project:${projectId}/todos`;
}

/** One project's review requests. */
export function teamProjectReviewsTopic(projectId: string): string {
    return `project:${projectId}/reviews`;
}

/** One project's milestones. */
export function teamProjectMilestonesTopic(projectId: string): string {
    return `project:${projectId}/milestones`;
}

/** Where one project's scenes and assets stand (the `approvals` capability). */
export function teamProjectApprovalsTopic(projectId: string): string {
    return `project:${projectId}/approvals`;
}

/** Who holds which of one project's assets (the `locks` capability). */
export function teamProjectLocksTopic(projectId: string): string {
    return `project:${projectId}/locks`;
}

/** One project's playable builds (the `builds` capability). */
export function teamProjectBuildsTopic(projectId: string): string {
    return `project:${projectId}/builds`;
}

/** One project's applied edits, saved versions and restores (the `documents` capability). */
export function teamProjectDocTopic(projectId: string): string {
    return `project:${projectId}/doc`;
}

/** A project's chat: a message sent or taken back. */
export function teamProjectChatTopic(projectId: string): string {
    return `project:${projectId}/chat`;
}

/** The signed-in account's own to-dos. Only that account may subscribe. */
export function teamAccountTodosTopic(accountId: string): string {
    return `account:${accountId}/todos`;
}

/** The signed-in account's notifications. Only that account may subscribe. */
export function teamAccountNotificationsTopic(accountId: string): string {
    return `account:${accountId}/notifications`;
}

/**
 * What is being said inside one live session.
 *
 * The only topic here that is not about something stored. Nothing published on it is
 * kept: it reaches whoever is subscribed at that instant and is forgotten. A window that
 * was not connected missed it and has nothing to re-read, because anything that had to
 * survive was written through `overlay.put` or pushed to the repository.
 */
export function teamLiveTopic(sessionId: string): string {
    return `live:${sessionId}`;
}

/**
 * The four topics a management surface listens on.
 *
 * **Named outright rather than built, and that is the shape of the thing rather than a
 * shortcut.** Every topic above is a function because it addresses one project or one live
 * session, and the id has to go into the string. These address the server, of which a
 * session has exactly one, so a builder for them would take no argument - a constant
 * wearing brackets, and one more thing for a caller to get wrong.
 *
 * All four are refused to anybody who is not an operator, which no other topic on this
 * server is: the rest are about projects, and every account reaches every project. Studio
 * subscribes to none of them yet.
 */

/** An account was made, disabled, enabled, given or denied administration, or had its tokens refused. */
export const TEAM_TOPIC_ADMIN_USERS = "admin/users";

/** A setting of this server changed. */
export const TEAM_TOPIC_ADMIN_SETTINGS = "admin/settings";

/** This server rotated its signing keys. */
export const TEAM_TOPIC_ADMIN_KEYS = "admin/keys";

/**
 * A decision this server was asked to make was **refused**.
 *
 * Named for what it publishes rather than for a collection, which is the design rather
 * than a shortening: a decision is recorded on the path that answers every repository
 * access, so a topic firing per decision would push more frames than the rest of this
 * protocol together, to tell a panel something it could only act on by re-reading a page
 * it already holds.
 *
 * Said plainly so that nobody reads this as a list-changed topic with events missing: **an
 * allowed decision is published nowhere**, and the sequence here counts refusals rather
 * than rows. Anything wanting the whole log pages `admin.audit.list` instead.
 */
export const TEAM_TOPIC_ADMIN_REFUSALS = "admin/refusals";

/* ------------------------------------------------------------------ limits */

/** The most one anchor field the server stores may be. */
export const TEAM_ANCHOR_FIELD_LIMIT = 512;

/** The most a comment may be. */
export const TEAM_COMMENT_BODY_LIMIT = 8 * 1024;

/** The most a suggestion may carry. */
export const TEAM_SUGGESTION_LIMIT = 64 * 1024;

/** The most one overlay record may carry. */
export const TEAM_OVERLAY_BODY_LIMIT = 64 * 1024;

/** The most one thing said in a live session may be. */
export const TEAM_LIVE_PAYLOAD_LIMIT = 16 * 1024;

/** The most any single field describing an installation may be. */
export const TEAM_INSTANCE_FIELD_LIMIT = 256;

/** The most one `doc.intent` may carry, as JSON: its document address and its operation. */
export const TEAM_DOC_INTENT_LIMIT = 96 * 1024;

/** The longest chat message, in characters. */
export const TEAM_CHAT_BODY_LIMIT = 4096;

/** The longest message or note on an access request, in characters. */
export const TEAM_ACCESS_REQUEST_MESSAGE_LIMIT = 1000;

/**
 * The most a server sends in one answer, and so the least this build's reader may hold.
 *
 * **The only limit here that bounds what arrives rather than what is sent**, and the
 * distinction is worth stating because getting it the wrong way round ends sessions.
 * Everything above bounds one field Studio writes; this bounds the whole of what comes
 * back, which is a page of rows rather than one of them - so it is far larger than the
 * largest thing this side ever sends, and a transport ceiling set from one of the others
 * refuses ordinary answers.
 *
 * Taken from the contract rather than reasoned out here, so that a deployment which
 * raises what it composes cannot leave this client refusing what that deployment sends.
 *
 * The contract states one more figure beside it - what the rows on a single page may
 * weigh - which is how a server decides where to end a page. Nothing on this side
 * composes one, so it has no constant here; what a reader needs is the cursor or the
 * count that comes back with a page that was cut.
 */
export const TEAM_ANSWER_BYTES_LIMIT = 2 * 1024 * 1024;

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
    | { kind: "comment-updated"; thread: string; comment: TeamComment }
    | { kind: "reaction"; reaction: TeamReaction };

/** The eight emoji a server keeps as reactions, in the order it lists them. */
export const TEAM_REACTIONS = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"] as const;
export type TeamReactionEmoji = (typeof TEAM_REACTIONS)[number];

/** One emoji on one comment or chat message, and who gave it. `by` is empty once nobody has. */
export interface TeamReaction {
    target: string;
    emoji: TeamReactionEmoji;
    by: string[];
}

/** One term of a project's glossary and how each language says it. */
export interface TeamGlossaryEntry {
    id: string;
    project: string;
    term: string;
    /** Locale tag → how that language says it. */
    translations: Record<string, string>;
    note?: string;
    createdAt: number;
    updatedAt: number;
    updatedBy?: string;
}

/** Where one voiced line (by textId) stands in one language. A line with no record is not recorded. */
export interface TeamVoiceLine {
    project: string;
    locale: string;
    line: string;
    status: "recorded" | "retake";
    take?: number;
    note?: string;
    updatedAt: number;
    updatedBy?: string;
}

/** A project template: members, planned milestones and to-dos it puts into a project. */
export interface TeamProjectTemplate {
    id: string;
    name: string;
    description?: string;
    body: {
        members?: { username: string; template: string }[];
        milestones?: { name: string; note?: string; dueInDays?: number }[];
        todos?: { title: string; body?: string; kind?: string; locale?: string; labels?: string[]; milestone?: string; dueInDays?: number }[];
    };
    createdBy?: string;
    createdAt: number;
    updatedAt: number;
}

/** What `templates.apply` put into a project. */
export interface TeamTemplateApplied {
    members: string[];
    milestones: number;
    todos: number;
    skipped: string[];
}

/** Following a project (no scope) or one scene of it (`scene:{id}`), as `watches.list` answers. */
export interface TeamWatch {
    project: string;
    scope?: string;
    createdAt: number;
}

/**
 * What arrives on the projects topic. Each goes only to the accounts it concerns: a project
 * being made or forgotten to its members, `project-access-changed` to the one account whose
 * role in it changed — read the list again.
 */
export type TeamProjectsEvent =
    | { kind: "project-created"; project: string }
    | { kind: "project-forgotten"; project: string }
    | { kind: "project-read"; project: string }
    | { kind: "project-access-changed"; project: string }
    | { kind: "access-request"; request: TeamAccessRequest };

/**
 * An account's role in one project, most able first. Owners and editors open the
 * repository; reviewers and viewers read the project through Team only, because the
 * version-control server does not tell a read from a write. Every project row the server
 * answers with carries the caller's own role as `role`.
 */
export type TeamProjectRole = "owner" | "editor" | "reviewer" | "viewer";

/**
 * The parts of a project an owner grants editing of separately. An editor kept to some of them
 * has `areas` on its member row and on the project rows it is answered; no list means all.
 */
export const TEAM_PROJECT_AREAS = ["story", "characters", "assets", "ui", "localization", "config"] as const;
export type TeamProjectArea = (typeof TEAM_PROJECT_AREAS)[number];

/**
 * Whether a role may open the repository: pull, commit and push. An editor kept to some areas
 * may not - the repository cannot tell one file from another - and edits through Team instead.
 */
export function teamRoleReachesRepository(
    role: TeamProjectRole | undefined,
    areas?: readonly TeamProjectArea[],
): boolean {
    if (role === "editor" && areas !== undefined && areas.length < TEAM_PROJECT_AREAS.length) {
        return false;
    }
    return role === undefined || role === "owner" || role === "editor";
}

/** A named grant every Team and every Studio knows by the same id. */
export interface TeamPermissionTemplate {
    id: string;
    role: TeamProjectRole;
    /** For an editor kept to some areas, which ones; absent for all of them. */
    areas?: readonly TeamProjectArea[];
}

/** The templates, in the order a picker shows them; pinned to the contract's `permissionTemplates`. */
export const TEAM_PERMISSION_TEMPLATES = [
    { id: "owner", role: "owner" },
    { id: "editor", role: "editor" },
    { id: "writer", role: "editor", areas: ["story", "characters"] },
    { id: "artist", role: "editor", areas: ["characters", "assets", "ui"] },
    { id: "translator", role: "editor", areas: ["localization"] },
    { id: "engineer", role: "editor", areas: ["ui", "config"] },
    { id: "reviewer", role: "reviewer" },
    { id: "viewer", role: "viewer" },
] as const satisfies readonly TeamPermissionTemplate[];
export type TeamPermissionTemplateId = (typeof TEAM_PERMISSION_TEMPLATES)[number]["id"];

/** The template a grant is, if it is one: the same role and exactly the same areas (all areas is `editor`). */
export function teamTemplateOf(
    role: TeamProjectRole,
    areas?: readonly TeamProjectArea[],
): (TeamPermissionTemplate & { id: TeamPermissionTemplateId }) | undefined {
    const all = (list?: readonly TeamProjectArea[]) => list === undefined || TEAM_PROJECT_AREAS.every((area) => list.includes(area));
    return (TEAM_PERMISSION_TEMPLATES as readonly (TeamPermissionTemplate & { id: TeamPermissionTemplateId })[]).find((template) => {
        if (template.role !== role) return false;
        if (role !== "editor") return true;
        if (template.areas === undefined) return all(areas);
        if (areas === undefined || all(areas)) return false;
        return template.areas.length === areas.length && template.areas.every((area) => areas.includes(area));
    });
}

/** A request for access: to a project (`project`), or for leave to make projects (`creator`). */
export interface TeamAccessRequest {
    id: number;
    kind: "project" | "creator";
    project?: string;
    projectName?: string;
    requester: string;
    requesterName?: string;
    role?: TeamProjectRole;
    areas?: TeamProjectArea[];
    template?: string;
    /** The asker's role in the project when it asked, if it had one. */
    currentRole?: TeamProjectRole;
    message?: string;
    status: "pending" | "approved" | "denied" | "withdrawn";
    at: number;
    decidedBy?: string;
    decidedAt?: number;
    note?: string;
    grantedRole?: TeamProjectRole;
    grantedAreas?: TeamProjectArea[];
}

/** A project the caller has no role in, as `projects.discover` answers. */
export interface TeamDiscoverableProject {
    id: string;
    name: string;
    description?: string;
}

/** One account's place in one project, as `projects.members.list` answers. */
export interface TeamProjectMember {
    username: string;
    displayName: string;
    role: TeamProjectRole;
    addedBy?: string;
    addedAt: number;
    /** The areas an editor may change, when the owners kept them to some. */
    areas?: TeamProjectArea[];
}

/** One installation the account is signed in on through the browser, as `account.devices.list` answers. */
export interface TeamAccountDevice {
    id: string;
    name: string;
    client: string;
    signedInAt: number;
    lastUsedAt: number;
}

/** A to-do, as `todos.*` answer and the to-do topics carry it. */
export interface TeamTodo {
    id: string;
    owner: string;
    assignee?: string;
    project?: string;
    anchor?: { document: string; element: string; revision?: string };
    title: string;
    body?: string;
    status: "open" | "doing" | "done";
    visibility: "private" | "project";
    /** What it asks for. Absent from a server older than kinds, where everything is a task. */
    kind?: "task" | "asset" | "translation" | "voice";
    /** The language a translation or voice to-do is about. */
    locale?: string;
    /** The asset that answered an asset request. */
    asset?: string;
    /** Free labels - "chapter 1", "voice" - absent from a server older than them. */
    labels?: string[];
    dueAt?: number;
    createdAt: number;
    updatedAt: number;
    doneAt?: number;
    /** The revision that finished it, where it was ticked off in a commit. */
    doneRevision?: string;
    /** The milestone of the same project it counts toward, by id. */
    milestone?: string;
}

/** Where one scene or asset stands. `target` is `scene:{id}` or `asset:{id}`. */
export interface TeamApproval {
    project: string;
    target: string;
    status: "draft" | "pending" | "approved" | "changes";
    /** Who moved it there, by username. */
    by?: string;
    /** Why - always there when it was sent back. */
    note?: string;
    at: number;
}

export type TeamApprovalsEvent = { kind: "approval-set"; approval: TeamApproval };

/** Somebody holds one asset of a project until `expiresAt`. */
export interface TeamAssetLock {
    project: string;
    asset: string;
    /** Who holds it, by username. */
    holder: string;
    note?: string;
    at: number;
    expiresAt: number;
}

export type TeamLocksEvent =
    | { kind: "lock-set"; lock: TeamAssetLock }
    | { kind: "lock-released"; project: string; asset: string };

/** How long `assets.lock` holds an asset when it is not told, in minutes. */
export const TEAM_ASSET_LOCK_DEFAULT_MINUTES = 4 * 60;

/** One playable build kept beside a project. The bytes are at `/api/team/v1/projects/{project}/builds/{id}`. */
export interface TeamBuild {
    id: string;
    project: string;
    name: string;
    note?: string;
    /** The revision it was built from, where the uploader said. */
    revision?: string;
    /** What it runs on, as the uploader put it: `windows`, `mac`, `web`... Never interpreted. */
    platform?: string;
    /** The file's own name, for the download. */
    file: string;
    size: number;
    sha256: string;
    uploadedBy?: string;
    createdAt: number;
    /** The one build of the project to play now. At most one is. */
    latest: boolean;
}

export type TeamBuildsEvent =
    | { kind: "build-set"; build: TeamBuild }
    | { kind: "build-removed"; build: string };

/** A picture kept beside a comment. Its bytes are at `/api/team/v1/projects/{project}/attachments/{id}`. */
export interface TeamAttachment {
    id: string;
    project: string;
    type: "png" | "jpg" | "webp";
    size: number;
    uploadedBy?: string;
    createdAt: number;
}

/** A read-only link for somebody without an account. The token is shown once, at creation. */
export interface TeamShareLink {
    id: string;
    project: string;
    label: string;
    /** `project`, or `story:{id}`. Never read by the server. */
    scope: string;
    revision: string;
    paths?: string[];
    allowComments: boolean;
    expiresAt?: number;
    revokedAt?: number;
    createdBy?: string;
    createdAt: number;
    lastUsedAt?: number;
    uses: number;
}

/** The largest build a server takes. */
export const TEAM_BUILD_MAX_BYTES = 1024 * 1024 * 1024;
/** The largest picture a server keeps beside a comment. */
export const TEAM_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
/** How a comment body points at a picture kept beside it. */
export function teamAttachmentMarker(id: string): string {
    return `[[attachment:${id}]]`;
}

export type TeamTodosEvent =
    | { kind: "todo-set"; todo: TeamTodo }
    | { kind: "todo-removed"; todo: string };

/** One notification, as `notifications.list` answers. */
export interface TeamNotification {
    id: number;
    kind: "mention" | "reply" | "assigned" | "review-requested" | "review-answered" | "access-requested" | "access-decided" | "watch";
    project?: string;
    ref?: string;
    actor?: string;
    summary?: string;
    at: number;
    readAt?: number;
}

export type TeamNotificationsEvent =
    | { kind: "notification"; notification: TeamNotification }
    | { kind: "notifications-read"; ids: number[] | "all" };

/** What arrives on a project's members topic. */
export type TeamProjectMembersEvent =
    | { kind: "member-set"; member: TeamProjectMember }
    | { kind: "member-removed"; username: string };

/* ------------------------------------------------------- client instances */

/**
 * One installation of Studio, as a server knows it while it is connected.
 *
 * **An instance is a window, not a person and not a machine.** The account says who; the
 * instance says which project on which installation, because that is the unit anything
 * real-time has to address. Studio composes the id out of its own installation id and the
 * repository id of the project the window holds, so the same window reopened after a
 * restart is recognisably the same instance - see `teamInstanceId`.
 *
 * Nothing about one is stored on the server. It is a fact about who is here now, and it
 * ends when the socket does.
 */
export interface TeamClientInstance {
    id: string;
    /** Which account it is connected as, by username. */
    account: string;
    /** What a person would call this machine, as this installation chose to say it. */
    label: string;
    /** Which client and which build, for a line in a log. */
    agent: string;
    /** The project this window has open, absent for an installation that named none. */
    project?: string;
    /** What that project stands at on that machine, as it reported it. */
    revision?: string;
    /**
     * The document it has in front of it, in anchor terms (`story:<id>`, `ui:<id>`), and since
     * when (the server's clock). A hint for somebody about to open the same one, never a lock.
     */
    editing?: string;
    editingSince?: number;
    /** When it announced itself on its current link session. Epoch ms, the server's clock. */
    since: number;
}

/** What arrives on a project's clients topic. */
export type TeamClientsEvent =
    | { kind: "client-here"; client: TeamClientInstance }
    | { kind: "client-gone"; client: string };

/* ---------------------------------------------------------- live sessions */

/**
 * A room on one project, opened by a person.
 *
 * It exists to answer which installations are working on this together right now, and to
 * give the server somewhere to send what one of them says to the others. **It holds
 * nothing**: everything produced inside one is written through overlay or pushed to the
 * repository, both of which are still there when the room is not. So it lives in the
 * server's memory, a restart ends every one of them, and nothing is lost.
 */
export interface TeamLiveSession {
    id: string;
    project: string;
    /** What the project stood at when it was opened, as the opener reported it. */
    revision?: string;
    /**
     * Which story document the room is about, as the opener named it.
     *
     * **This is what a joiner follows instead of guessing.** The server requires it of every
     * room opened, so a current one always has it; it is optional here for the reason `revision`
     * is - what arrives is read defensively, and a room opened against an older deployment has
     * none. Joining such a room is refused by name rather than by falling back to a guess: the
     * only thing this window could guess is a document it already holds, which is both the wrong
     * answer for somebody whose copy differs and no answer at all for somebody who has just
     * arrived.
     */
    story?: string;
    title?: string;
    /** Who opened it, by username. */
    openedBy: string;
    openedByInstance: string;
    openedAt: number;
    /** Who is in it now. Never empty: the last one out closes it. */
    members: TeamLiveMember[];
    /**
     * How somebody gets into it.
     *
     * Absent from a room opened against a deployment older than the rule, which
     * behaves as `open` and always did - so a reader that treats "nothing said" as
     * `open` is reading it correctly rather than guessing.
     */
    rule?: TeamLiveJoinRule;
}

/**
 * How a room may be joined.
 *
 * ⚠ **The four digits are not here and must never be put here.** A room record is
 * broadcast on the project's topic, which everybody on the project is watching, and a
 * passcode broadcast to everybody has said nothing. The server answers it to the window
 * that opened the room and to nobody else.
 *
 * **Two questions, not one**: whether the room can be found, and whether a person decides
 * who comes in. The three rules are three of the four corners.
 *
 *  - `open` - on the project's list, joinable by anybody who can see it.
 *  - `code` - not on that list for anybody who is not already in it, and joined by the
 *    digits minted when it opened. **The server enforces both halves**: a list that
 *    carried the room would be a rule one client build keeps, and an id that was enough
 *    to join by would be a rule about listings rather than about joining.
 *  - `request` - on the list like `open`, and joined only once whoever opened it has said
 *    yes. Walking in with the id is refused, for the same reason.
 *
 * The fourth corner - a code and an answer - is deliberately not offered: a code is
 * already a door, and a second one asks the host to decide something they know nothing
 * more about than the code did.
 */
export type TeamLiveJoinRule = "open" | "code" | "request";

export interface TeamLiveMember {
    instance: string;
    account: string;
    label: string;
    joinedAt: number;
}

/** What arrives on a project's live topic. */
export type TeamLiveEvent =
    | { kind: "live-opened"; session: TeamLiveSession }
    | { kind: "live-changed"; session: TeamLiveSession }
    | { kind: "live-closed"; session: string }
    /**
     * Somebody wants into a `request` room. For whoever opened it, and for nobody else.
     *
     * ⚠ **On the project's topic rather than the room's**, because the person who asked is
     * not in the room and has nothing else to listen to. So every window on the project
     * sees it and all but one must ignore it - which is consistent with a deployment where
     * every account already reaches every project.
     */
    | { kind: "live-requested"; session: string; member: TeamLiveMember }
    /**
     * A request that was answered no.
     *
     * Being let in has no event of its own: it is a change to the roster, and `live-changed`
     * already says that - so a window that asked learns it is in by finding itself in the
     * members.
     */
    | { kind: "live-refused"; session: string; instance: string };

/**
 * One thing said inside a live session, as it arrives on that session's topic.
 *
 * `payload` is Studio's own and the server never reads it. Every participant receives
 * every message including their own, which is what lets a window tell a round trip it
 * made from one it did not.
 */
export interface TeamLiveMessage {
    session: string;
    /** The instance that said it. */
    from: string;
    account: string;
    at: number;
    payload: unknown;
}

/* --------------------------------------------------------------- overlay */

/**
 * Something attached to a project at a revision, which is not in the repository.
 *
 * **The third place a project's content can live, and the only one that is neither the
 * repository nor a version of it.** A revision is what an author recorded; a thread is a
 * conversation about one; a record here is anything else Studio wants kept beside a place
 * in a project without changing what that project is - a review mark on a story row, a
 * translator's flag, a note from a playtest.
 *
 * `kind` and `body` are Studio's, and the server groups by the first and never opens the
 * second. Whether a record is still about anything is Studio's question too: the server
 * hands back the revision each record was written against and the head it last read, and
 * makes no comparison, because only this side is holding the document.
 */
export interface TeamOverlayRecord {
    id: string;
    project: string;
    /** Where it is attached. `revision` is always there, unlike a thread's. */
    anchor: TeamAnchor & { revision: string };
    kind: string;
    body: string;
    /** Who wrote it, by username, and absent for an account the server no longer has. */
    author?: string;
    /** Which installation wrote it, absent for one that did not say. */
    instance?: string;
    createdAt: number;
    updatedAt: number;
}

/** What arrives on a project's overlay topic. */
export type TeamOverlayEvent =
    | { kind: "overlay-put"; record: TeamOverlayRecord }
    | { kind: "overlay-dropped"; record: string; anchor: TeamAnchor };

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
    projectsHistory: "projects.history",
    projectsCreate: "projects.create",
    projectsForget: "projects.forget",
    projectsMembersList: "projects.members.list",
    projectsMembersSet: "projects.members.set",
    projectsMembersRemove: "projects.members.remove",
    projectsDiscover: "projects.discover",
    accessRequestsList: "access.requests.list",
    accessRequestsCreate: "access.requests.create",
    accessRequestsDecide: "access.requests.decide",
    accessRequestsWithdraw: "access.requests.withdraw",
    projectsUpdate: "projects.update",
    projectsWebhooksList: "projects.webhooks.list",
    projectsWebhooksCreate: "projects.webhooks.create",
    projectsWebhooksDelete: "projects.webhooks.delete",
    projectsWebhooksTest: "projects.webhooks.test",
    projectsWebhooksDeliveries: "projects.webhooks.deliveries",
    projectsWebhooksRedeliver: "projects.webhooks.redeliver",
    accountDevicesList: "account.devices.list",
    accountDevicesRevoke: "account.devices.revoke",
    accountProfileGet: "account.profile.get",
    accountProfileUpdate: "account.profile.update",
    activityList: "activity.list",
    activityHeatmap: "activity.heatmap",
    todosList: "todos.list",
    todosCreate: "todos.create",
    todosUpdate: "todos.update",
    todosDelete: "todos.delete",
    reviewsList: "reviews.list",
    reviewsCreate: "reviews.create",
    reviewsUpdate: "reviews.update",
    milestonesList: "milestones.list",
    chatList: "chat.list",
    chatSend: "chat.send",
    chatDelete: "chat.delete",
    milestonesCreate: "milestones.create",
    milestonesDelete: "milestones.delete",
    milestonesUpdate: "milestones.update",
    approvalsList: "approvals.list",
    approvalsSet: "approvals.set",
    approvalsHistory: "approvals.history",
    assetsLocks: "assets.locks",
    assetsLock: "assets.lock",
    assetsUnlock: "assets.unlock",
    buildsList: "builds.list",
    buildsUpdate: "builds.update",
    buildsDelete: "builds.delete",
    attachmentsDelete: "attachments.delete",
    sharesList: "shares.list",
    sharesCreate: "shares.create",
    sharesRevoke: "shares.revoke",
    filtersList: "filters.list",
    filtersSave: "filters.save",
    filtersDelete: "filters.delete",
    adminWebhooksList: "admin.webhooks.list",
    adminWebhooksCreate: "admin.webhooks.create",
    adminWebhooksDelete: "admin.webhooks.delete",
    adminWebhooksTest: "admin.webhooks.test",
    adminWebhooksDeliveries: "admin.webhooks.deliveries",
    adminWebhooksRedeliver: "admin.webhooks.redeliver",
    notificationsList: "notifications.list",
    notificationsRead: "notifications.read",
    notificationsPrefs: "notifications.prefs",
    notificationsPrefsSet: "notifications.prefs.set",
    notificationsHookTest: "notifications.hook.test",
    notificationsDigestNow: "notifications.digest.now",
    pushKey: "push.key",
    pushSubscribe: "push.subscribe",
    pushUnsubscribe: "push.unsubscribe",
    pushTest: "push.test",
    watchesList: "watches.list",
    watchesSet: "watches.set",
    reactionsList: "reactions.list",
    reactionsToggle: "reactions.toggle",
    glossaryList: "glossary.list",
    glossarySet: "glossary.set",
    glossaryDelete: "glossary.delete",
    voiceList: "voice.list",
    voiceSet: "voice.set",
    templatesList: "templates.list",
    templatesSave: "templates.save",
    templatesDelete: "templates.delete",
    templatesApply: "templates.apply",
    membersList: "members.list",
    threadsList: "threads.list",
    threadsGet: "threads.get",
    threadsCreate: "threads.create",
    threadsReply: "threads.reply",
    threadsResolve: "threads.resolve",
    commentsEdit: "comments.edit",
    commentsDelete: "comments.delete",
    clientsAnnounce: "clients.announce",
    clientsWithdraw: "clients.withdraw",
    clientsList: "clients.list",
    serverPing: "server.ping",
    liveList: "live.list",
    liveOpen: "live.open",
    liveJoin: "live.join",
    liveLeave: "live.leave",
    liveClose: "live.close",
    liveRule: "live.rule",
    /**
     * Which room a passcode names, without joining it.
     *
     * **The one live method that does not need this window to have the project open.**
     * Somebody was read four digits and may never have had the project; what they need
     * first is which project it is, so they can go and get it. Answering that is what
     * stops the one way in that needs no list from needing a list after all.
     */
    liveByCode: "live.byCode",
    /** Ask to be let into a room that is joined by asking. */
    liveRequestJoin: "live.requestJoin",
    /** Answer somebody who asked, which only the room's opener may do. */
    liveAnswerJoin: "live.answerJoin",
    liveSay: "live.say",
    // A team project's documents, with the server as their authority (`documents`).
    docHead: "doc.head",
    docEffects: "doc.effects",
    docBase: "doc.base",
    docFiles: "doc.files",
    docFile: "doc.file",
    docIntent: "doc.intent",
    docSnapshot: "doc.snapshot",
    docRestore: "doc.restore",
    overlayList: "overlay.list",
    overlayPut: "overlay.put",
    overlayDrop: "overlay.drop",
    // Managing the server itself: its accounts, its settings, its signing keys, its
    // decisions and its health. Announced by the `admin` capability and refused to anybody
    // who is not an operator. Named here because the contract names them and this list is
    // the whole of it; Studio calls none of them.
    adminDocumentsStatus: "admin.documents.status",
    adminUsersList: "admin.users.list",
    adminUsersCreate: "admin.users.create",
    adminUsersDisable: "admin.users.disable",
    adminUsersEnable: "admin.users.enable",
    adminUsersGrantAdmin: "admin.users.grantAdmin",
    adminUsersRevokeAdmin: "admin.users.revokeAdmin",
    adminUsersRevokeTokens: "admin.users.revokeTokens",
    adminUsersSetCreator: "admin.users.setCreator",
    adminUsersDelete: "admin.users.delete",
    adminUsersLock: "admin.users.lock",
    adminUsersUnlock: "admin.users.unlock",
    adminUsersUpdate: "admin.users.update",
    adminTokensMint: "admin.tokens.mint",
    adminSettingsList: "admin.settings.list",
    adminSettingsSet: "admin.settings.set",
    adminKeysList: "admin.keys.list",
    adminKeysRotate: "admin.keys.rotate",
    adminKeysRetire: "admin.keys.retire",
    adminAuditList: "admin.audit.list",
    adminServerStatus: "admin.server.status",
    adminBrandSet: "admin.brand.set",
    adminEmailTest: "admin.email.test",
    adminUsersResetLink: "admin.users.resetLink",
    adminUsersResetTwoFactor: "admin.users.resetTwoFactor",
    adminStorageList: "admin.storage.list",
    adminBackupsList: "admin.backups.list",
    adminBackupsCreate: "admin.backups.create",
    // The account's own two-step sign-in and access tokens (`two-factor`, `api-tokens`).
    // Set up in the web console, which can show a secret; Studio only sends codes.
    accountTotpStatus: "account.totp.status",
    accountTotpBegin: "account.totp.begin",
    accountTotpConfirm: "account.totp.confirm",
    accountTotpDisable: "account.totp.disable",
    accountTotpRecovery: "account.totp.recovery",
    accountTokensList: "account.tokens.list",
    accountTokensCreate: "account.tokens.create",
    accountTokensRevoke: "account.tokens.revoke",
    // Archiving a project, and how much it stores (`archive`, `storage`).
    projectsArchive: "projects.archive",
    projectsRestore: "projects.restore",
    projectsStorage: "projects.storage",
    // What an operator fixed on the account, and the Studio settings kept for it
    // (`account-policy`, `studio-config`). The settings themselves travel over HTTP at
    // TEAM_STUDIO_CONFIG_PATH; these only read and forget them.
    accountPolicy: "account.policy",
    accountStudioConfig: "account.studioConfig",
    accountStudioConfigDelete: "account.studioConfig.delete",
    adminPoliciesList: "admin.policies.list",
    adminPoliciesSave: "admin.policies.save",
    adminPoliciesDelete: "admin.policies.delete",
    adminUsersPolicy: "admin.users.policy",
    adminUsersPolicySet: "admin.users.policySet",
} as const;

/**
 * The id this installation announces for one project's window.
 *
 * **Composed rather than random, and composed of both halves on purpose.** The
 * installation id alone would make two windows of one Studio a single instance, and they
 * would overwrite each other's presence; a fresh id per connection would make the same
 * window a stranger every time it reconnected. This is stable across restarts and
 * distinct per project, which is exactly what a room's membership needs.
 *
 * The server never takes this apart. It is one opaque string to it, like every other id
 * Studio hands over.
 */
export function teamInstanceId(installation: string, projectId: string | null): string {
    return projectId === null ? installation : `${installation}.${projectId}`;
}

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
    /**
     * Why there is no session, where the reason is Studio's rather than the server's.
     *
     * **`offline` covers two things a screen has to say differently**: a host that is not
     * answering, and a server this installation cannot open a session with at all -
     * because it has no record of it, or because the sealed token cannot be read. The
     * second never reaches a socket, so there is no transport sentence to report and no
     * amount of waiting that fixes it. Absent for the ordinary case, where `detail`
     * carries what the transport said.
     */
    problem?: TeamProblem;
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

/** Backing the author's Studio settings up to a server, or reading them back. */
export type TeamStudioConfigRequest =
    | { readonly remoteOrigin: string; readonly action: "download" }
    | { readonly remoteOrigin: string; readonly action: "upload"; readonly content: string };

/** Why a settings backup or restore did not happen. */
export type TeamStudioConfigRefusal =
    /** No sign-in is held for that server, or the server no longer takes it. */
    | "signed-out"
    /** The account's policy does not allow it: settings kept read-only, or not kept at all. */
    | "forbidden"
    /** Larger than the server keeps. */
    | "too-large"
    /** The server is older than `studio-config`. */
    | "unsupported"
    /** The server could not be reached. */
    | "unreachable"
    /** Anything else the server said no to; `message` carries its sentence. */
    | "failed";

/**
 * What came of it. A download with no `content` means the server keeps nothing for this account yet.
 */
export type TeamStudioConfigOutcome =
    | { ok: true; content?: string }
    | { ok: false; reason: TeamStudioConfigRefusal; message?: string };

/** What a workspace asks of the main process to put one artifact of its last build on its server. */
export interface TeamUploadBuildRequest {
    readonly remoteOrigin: string;
    readonly projectId: string;
    /** Absolute path of one artifact of the project's last build. */
    readonly artifact: string;
    readonly name: string;
    readonly note?: string;
    /** Studio's platform name (`macos` and so on). */
    readonly platform?: string;
    readonly revision?: string;
    readonly latest?: boolean;
}
