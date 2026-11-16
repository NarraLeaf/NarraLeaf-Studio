import type { StoryCommentAuthor, StoryCommentThread } from "@shared/types/storyComments";
import type { TeamAnchor, TeamComment, TeamThread } from "@shared/types/team";

import type { StoryCommentRemoteThread, StoryCommentsService } from "./StoryCommentsService";

/**
 * Story-row comments, kept in step with the project's Team server.
 *
 * **One set of threads, wherever they are read.** A project on a Team server writes its row
 * comments to the server's threads, where the web console and every other Studio see them, and
 * keeps `editor/story-comments.json` as the offline copy. A project on no server keeps using the
 * file alone, exactly as before.
 *
 * The anchor vocabulary is shared with the console and never parsed by the server:
 * `document` = `story:<storyId>`, `element` = `<sceneId>/<blockId>`.
 *
 * Three directions:
 *  - **push**: a local thread with no `teamThreadId` is opened on the server, and a local comment
 *    with no `teamCommentId` is sent as a reply. Each carries its local id as the server's client
 *    id, so a push repeated after a dropped connection, or after an older Studio dropped the
 *    mapping on save, finds the write already made instead of making a second one. A thread
 *    resolved or reopened here is resolved or reopened there.
 *  - **pull**: every story thread on the server is taken as the server has it.
 *  - **live**: the project's threads topic triggers a pull of the thread that moved.
 *
 * A comment already sent and then edited or deleted here is edited or withdrawn there. The server
 * refuses that for somebody else's comment; the thread is then pulled again, so the row shows what
 * the server kept rather than an edit nobody else will ever see.
 */

/** The calls this needs, named so a test can drive it without a socket. */
export interface StoryCommentsTeamTransport {
    listThreads(page: { document?: string; before?: string }): Promise<{ threads: TeamThread[]; cursor?: string } | null>;
    getThread(thread: string): Promise<{ thread: TeamThread; comments: TeamComment[] } | null>;
    createThread(input: {
        anchor: TeamAnchor;
        body: string;
        clientId: string;
        kind?: "comment" | "suggestion";
        suggestion?: string;
    }): Promise<{ thread: TeamThread; opening?: TeamComment } | null>;
    reply(input: { thread: string; body: string; clientId: string }): Promise<TeamComment | null>;
    resolve(thread: string, resolved: boolean): Promise<boolean>;
    /** Make a project to-do; answers its id. Optional: a server without `todos` has none. */
    createTodo?(input: { title: string; anchor: TeamAnchor; clientId: string }): Promise<string | null>;
    /** Move a to-do's status. */
    setTodoStatus?(todo: string, status: "open" | "done"): Promise<boolean>;
    /** Change the wording of a comment already sent. False when refused or not sent. */
    editComment?(comment: string, body: string): Promise<boolean>;
    /** Withdraw a comment already sent. False when refused or not sent. */
    deleteComment?(comment: string): Promise<boolean>;
}

const STORY_PREFIX = "story:";

export function storyCommentAnchor(thread: Pick<StoryCommentThread, "storyId" | "sceneId" | "blockId">): TeamAnchor {
    return { document: `${STORY_PREFIX}${thread.storyId}`, element: `${thread.sceneId}/${thread.blockId}` };
}

/** The row an anchor names, or null for one that is not about a story row. */
export function storyRowOfAnchor(anchor: TeamAnchor): { storyId: string; sceneId: string; blockId: string } | null {
    if (!anchor.document?.startsWith(STORY_PREFIX) || anchor.element === undefined) return null;
    const separator = anchor.element.indexOf("/");
    if (separator <= 0 || separator === anchor.element.length - 1) return null;
    return {
        storyId: anchor.document.slice(STORY_PREFIX.length),
        sceneId: anchor.element.slice(0, separator),
        blockId: anchor.element.slice(separator + 1),
    };
}

function authorOf(username: string | undefined): StoryCommentAuthor {
    return { name: username ?? "?" };
}

/** A server thread and its comments, in the document's terms, or null for one not on a story row. */
export function remoteStoryThread(thread: TeamThread, comments: readonly TeamComment[]): StoryCommentRemoteThread | null {
    const row = storyRowOfAnchor(thread.anchor);
    if (row === null) return null;
    return {
        teamThreadId: thread.id,
        ...row,
        resolved: thread.status === "resolved",
        ...(thread.resolvedBy === undefined ? {} : { resolvedBy: authorOf(thread.resolvedBy) }),
        ...(thread.resolvedAt === undefined ? {} : { resolvedAt: thread.resolvedAt }),
        createdAt: thread.createdAt,
        ...(thread.kind === "suggestion" && comments[0]?.suggestion !== undefined ? { suggestion: comments[0].suggestion } : {}),
        comments: comments
            // A withdrawn comment has no body left to show; the conversation keeps its shape on the
            // server, and here it is simply not drawn.
            .filter(comment => comment.deletedAt === undefined)
            .map(comment => ({
                teamCommentId: comment.id,
                author: authorOf(comment.author),
                body: comment.body,
                createdAt: comment.createdAt,
                ...(comment.editedAt === undefined ? {} : { editedAt: comment.editedAt }),
            })),
    };
}

export class StoryCommentsTeamSync {
    /** What each synced thread's resolved state was when last agreed with the server. */
    private readonly agreedResolved = new Map<string, boolean>();
    /** The wording each sent comment had when last agreed with the server. */
    private readonly agreedBody = new Map<string, string>();
    /** The sent comments each synced thread had when last agreed, to tell a deletion here. */
    private readonly agreedComments = new Map<string, Set<string>>();
    private pushing: Promise<void> | null = null;
    private again = false;
    private stopped = false;

    constructor(
        private readonly service: StoryCommentsService,
        private readonly transport: StoryCommentsTeamTransport,
    ) {}

    stop(): void {
        this.stopped = true;
    }

    /** Take every story thread on the server. */
    async pullAll(): Promise<void> {
        let before: string | undefined;
        for (let page = 0; page < 100 && !this.stopped; page += 1) {
            const answer = await this.transport.listThreads(before === undefined ? {} : { before });
            if (answer === null) return;
            for (const thread of answer.threads) {
                if (storyRowOfAnchor(thread.anchor) !== null) await this.pullThread(thread.id);
            }
            if (answer.cursor === undefined) return;
            before = answer.cursor;
        }
    }

    /** Take one thread as the server has it. */
    async pullThread(teamThreadId: string): Promise<void> {
        // An edit or deletion made here and not sent yet would be overwritten by the server's
        // wording; send it first.
        if (this.hasUnsentChange(teamThreadId)) await this.push();
        await this.take(teamThreadId);
    }

    private async take(teamThreadId: string): Promise<void> {
        const answer = await this.transport.getThread(teamThreadId);
        if (answer === null || this.stopped) return;
        const remote = remoteStoryThread(answer.thread, answer.comments);
        if (remote === null) return;
        this.agreedResolved.set(remote.teamThreadId, remote.resolved);
        this.agreedComments.set(remote.teamThreadId, new Set(remote.comments.map(comment => comment.teamCommentId)));
        for (const comment of remote.comments) this.agreedBody.set(comment.teamCommentId, comment.body);
        this.service.applyRemoteThread(remote);
    }

    private hasUnsentChange(teamThreadId: string): boolean {
        const agreed = this.agreedComments.get(teamThreadId);
        if (agreed === undefined) return false;
        const local = this.service.listThreads().find(thread => thread.teamThreadId === teamThreadId);
        if (local === undefined) return agreed.size > 0;
        const here = new Set<string>();
        for (const comment of local.comments) {
            if (comment.teamCommentId === undefined) continue;
            here.add(comment.teamCommentId);
            const body = this.agreedBody.get(comment.teamCommentId);
            if (body !== undefined && body !== comment.body) return true;
        }
        return [...agreed].some(id => !here.has(id));
    }

    /**
     * Send edits and deletions of comments already on the server. Answers whether the server
     * refused any, so the caller pulls the thread back to what it kept.
     */
    private async pushChanges(
        local: StoryCommentThread | undefined,
        teamThreadId: string,
        sent: Readonly<Record<string, string>> = {},
    ): Promise<boolean> {
        const { editComment, deleteComment } = this.transport;
        if (editComment === undefined || deleteComment === undefined) return false;
        const agreed = this.agreedComments.get(teamThreadId) ?? new Set<string>();
        let refused = false;
        // What this push has just sent is here too, though the snapshot predates it.
        const here = new Set<string>(Object.values(sent));
        for (const comment of local?.comments ?? []) {
            if (comment.teamCommentId === undefined) continue;
            here.add(comment.teamCommentId);
            const body = this.agreedBody.get(comment.teamCommentId);
            if (body === undefined || body === comment.body) continue;
            if (await editComment.call(this.transport, comment.teamCommentId, comment.body)) {
                this.agreedBody.set(comment.teamCommentId, comment.body);
            } else {
                refused = true;
            }
        }
        for (const id of [...agreed]) {
            if (here.has(id)) continue;
            if (await deleteComment.call(this.transport, id)) {
                agreed.delete(id);
                this.agreedBody.delete(id);
            } else {
                refused = true;
            }
        }
        return refused;
    }

    /** Send what is here and not there. Serialized: a push asked for during one runs once after it. */
    push(): Promise<void> {
        if (this.pushing !== null) {
            this.again = true;
            return this.pushing;
        }
        this.pushing = (async () => {
            do {
                this.again = false;
                await this.pushOnce();
            } while (this.again && !this.stopped);
        })().finally(() => {
            this.pushing = null;
        });
        return this.pushing;
    }

    /** What each to-do's status was when last told to the server. */
    private readonly agreedTodo = new Map<string, "open" | "done">();

    /**
     * A thread marked as a to-do becomes a project to-do on the same row; resolving the thread
     * finishes it and reopening reopens it. A mark taken off leaves the to-do where it is: somebody
     * may have taken it on from the board, and that is theirs to close.
     */
    private async pushTodo(thread: StoryCommentThread, teamThreadId: string): Promise<void> {
        if (this.transport.createTodo === undefined || this.transport.setTodoStatus === undefined) return;
        let todoId = thread.teamTodoId;
        if (todoId === undefined) {
            if (!thread.todo) return;
            const title = thread.excerpt || thread.comments[0]?.body || "";
            const created = await this.transport.createTodo({
                title: title.slice(0, 300) || "…",
                anchor: storyCommentAnchor(thread),
                clientId: `${teamThreadId}:todo`,
            });
            if (created === null) return;
            todoId = created;
            this.service.markTodoSynced(thread.id, todoId);
            this.agreedTodo.set(todoId, "open");
        }
        const wanted = thread.resolved ? "done" : "open";
        if (this.agreedTodo.get(todoId) !== wanted && (thread.resolved || this.agreedTodo.has(todoId))) {
            if (await this.transport.setTodoStatus(todoId, wanted)) this.agreedTodo.set(todoId, wanted);
        }
    }

    private async pushOnce(): Promise<void> {
        const threads = this.service.listThreads();
        // Threads deleted here: withdraw what of them was sent.
        const present = new Set(threads.flatMap(thread => (thread.teamThreadId === undefined ? [] : [thread.teamThreadId])));
        for (const teamThreadId of [...this.agreedComments.keys()]) {
            if (this.stopped) return;
            if (present.has(teamThreadId)) continue;
            const refused = await this.pushChanges(undefined, teamThreadId);
            if (refused) await this.take(teamThreadId);
            else this.agreedComments.delete(teamThreadId);
        }
        for (const thread of threads) {
            if (this.stopped) return;
            const first = thread.comments[0];
            if (first === undefined) continue;
            let teamThreadId = thread.teamThreadId;
            const sent: Record<string, string> = {};
            if (teamThreadId === undefined) {
                const created = await this.transport.createThread({
                    anchor: storyCommentAnchor(thread),
                    body: first.body,
                    clientId: thread.id,
                    ...(thread.suggestion === undefined ? {} : { kind: "suggestion" as const, suggestion: thread.suggestion }),
                });
                if (created === null) continue;
                teamThreadId = created.thread.id;
                if (created.opening !== undefined) sent[first.id] = created.opening.id;
                this.agreedResolved.set(teamThreadId, created.thread.status === "resolved");
            }
            for (const comment of thread.comments) {
                if (comment.teamCommentId !== undefined || sent[comment.id] !== undefined) continue;
                if (comment === first && thread.teamThreadId === undefined) continue;
                const reply = await this.transport.reply({ thread: teamThreadId, body: comment.body, clientId: comment.id });
                if (reply !== null) sent[comment.id] = reply.id;
            }
            const agreed = this.agreedComments.get(teamThreadId) ?? new Set<string>();
            this.agreedComments.set(teamThreadId, agreed);
            for (const comment of thread.comments) {
                const id = comment.teamCommentId ?? sent[comment.id];
                if (id === undefined || this.agreedBody.has(id)) continue;
                // Sent just now, or known from a file written before this window opened.
                if (comment.teamCommentId === undefined) {
                    agreed.add(id);
                    this.agreedBody.set(id, comment.body);
                }
            }
            if (thread.teamThreadId === undefined || Object.keys(sent).length > 0) {
                this.service.markSynced(thread.id, teamThreadId, sent);
            }
            if (thread.teamThreadId !== undefined && (await this.pushChanges(thread, teamThreadId, sent))) {
                await this.take(teamThreadId);
            }
            await this.pushTodo(thread, teamThreadId);
            const agreedResolved = this.agreedResolved.get(teamThreadId);
            if (agreedResolved !== undefined && agreedResolved !== thread.resolved) {
                if (await this.transport.resolve(teamThreadId, thread.resolved)) {
                    this.agreedResolved.set(teamThreadId, thread.resolved);
                }
            }
        }
    }
}
