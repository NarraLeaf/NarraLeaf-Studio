import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { storyCommentsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import type { TranslationKey } from "@shared/i18n";
import { RendererError } from "@shared/utils/error";
import {
    createEmptyStoryCommentsDocument,
    normalizeStoryCommentsDocument,
    storyCommentExcerpt,
    type StoryComment,
    type StoryCommentAuthor,
    type StoryCommentThread,
    type StoryCommentsDocument,
} from "@shared/types/storyComments";
import { getInterface } from "@/lib/app/bridge";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { storeWrite } from "../autosave/writeReport";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import type { VersionControlService } from "../core/VersionControlService";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import type { HistoryScopeId } from "../history/historyModel";
import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { EventEmitter } from "../ui/EventEmitter";

/** The global setting that signs revisions, and the name a comment falls back to without a Team account. */
const LOCAL_AUTHOR_SETTING = "versionControl.authorName";

const STORE_LABEL: TranslationKey = "workspace.shell.save.stores.storyComments";

type StoryCommentsEvents = {
    /** Any thread moved. Carries nothing: readers ask for what they show. */
    changed: void;
    /** The name new comments are signed with changed. */
    authorChanged: StoryCommentAuthor | null;
};

/** Where an edit came from, which decides the undo stack it lands on. */
export type StoryCommentEditOptions = {
    /** The stack to record on. The scene editor passes its scene's; anything else gets the project's. */
    scopeId?: HistoryScopeId;
};

export type StoryCommentThreadInput = {
    storyId: string;
    sceneId: string;
    blockId: string;
    /** The row's text now; cut down to an excerpt here. */
    text?: string;
    body: string;
    todo?: boolean;
};

/**
 * Review threads on story rows. Owns `editor/story-comments.json`.
 *
 * Mirrors {@link DictionaryService}: one project JSON, seeded empty from absence and not written until
 * the first thread exists, debounced autosave, and the same refuse-to-overwrite latch for a file that
 * is on disk but unreadable. See `@shared/types/storyComments` for why comments are a document of
 * their own rather than a field of the story.
 *
 * Every edit is one undo step, recorded as a command (the thread before and after) on the stack the
 * caller names. That is what lets an edit made from the scene editor be taken back with the scene
 * editor's Ctrl+Z, though the scene document itself never changes.
 */
export class StoryCommentsService extends Service<StoryCommentsService> {
    private document: StoryCommentsDocument | null = null;
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<StoryCommentsEvents>();
    private revision = 0;
    /** Threads by the block they are about. Rebuilt on every change; read by every row on screen. */
    private byBlock = new Map<string, StoryCommentThread>();
    private author: StoryCommentAuthor | null = null;
    private unsubscribers: Array<() => void> = [];
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(),
        onError: err => console.warn("[StoryCommentsService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const historyService = ctx.services.get<HistoryService>(Services.History);
        await depend([filesystemService, projectService, historyService]);
        await registerAutoSaver(ctx, depend, "storyComments", STORE_LABEL, this.autoSaver);
        await this.load();

        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.unsubscribers = [];
        const token = getInterface().app.state.onGlobalStateChanged(change => {
            if (change.key === LOCAL_AUTHOR_SETTING) void this.refreshAuthor();
        });
        this.unsubscribers.push(() => token.cancel());
        // Version control comes up on its own schedule and is not a dependency: a project without it
        // still comments, under the local name. Its session change is listened to when it is there.
        try {
            const vcs = ctx.services.get<VersionControlService>(Services.VersionControl);
            this.unsubscribers.push(vcs.onSessionChanged(() => void this.refreshAuthor()));
        } catch {
            // No version control in this workspace.
        }
        void this.refreshAuthor();
    }

    public async load(): Promise<void> {
        const result = await loadDocument(storyCommentsSpec, this.storage(), storyCommentsSpec.pathFor());
        this.unreadable = null;
        this.revision = 0;
        if (result.status === "missing") {
            this.document = createEmptyStoryCommentsDocument();
        } else if (result.status === "corrupt") {
            this.unreadable = result.error;
            this.document = createEmptyStoryCommentsDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.document = result.document;
        }
        this.reindex();
        this.events.emit("changed", undefined);
    }

    public async save(): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace every thread with nothing.`,
            );
        }
        this.autoSaver.cancel();
        const document = normalizeStoryCommentsDocument(this.getDocument() as unknown as Record<string, unknown>);
        await saveDocument(storyCommentsSpec, this.storage(), storyCommentsSpec.pathFor(), document);
    }

    public getDocument(): StoryCommentsDocument {
        if (!this.document) {
            throw new RendererError("Story comments not initialized");
        }
        return this.document;
    }

    public getRevision(): number {
        return this.revision;
    }

    /** Every thread, oldest first. */
    public listThreads(): StoryCommentThread[] {
        return Object.values(this.document?.threads ?? {}).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }

    public getThread(threadId: string): StoryCommentThread | null {
        return this.document?.threads[threadId] ?? null;
    }

    /**
     * The thread a row shows, or null.
     *
     * A row carries one thread. Should a merge ever leave two on one row, the open one wins over a
     * resolved one and the newer over the older, so the mark always opens onto what still needs
     * saying - the other stays reachable from the panel.
     */
    public threadForBlock(blockId: string): StoryCommentThread | null {
        return this.byBlock.get(blockId) ?? null;
    }

    /** The name new comments are signed with, or null before it has been read. */
    public getAuthor(): StoryCommentAuthor | null {
        return this.author;
    }

    /** The name to sign with now: the cached one, or a fresh read when there is none yet. */
    public async resolveAuthor(): Promise<StoryCommentAuthor> {
        return this.author ?? await this.refreshAuthor();
    }

    public onChanged(handler: () => void): () => void {
        return this.events.on("changed", handler);
    }

    public onAuthorChanged(handler: (author: StoryCommentAuthor | null) => void): () => void {
        return this.events.on("authorChanged", handler);
    }

    /**
     * Open a thread on a row. A row that already has an open thread gets the comment as a reply
     * instead: one row, one conversation.
     */
    public createThread(input: StoryCommentThreadInput, options: StoryCommentEditOptions = {}): StoryCommentThread | null {
        const body = input.body.trim();
        if (!body) {
            return null;
        }
        const existing = this.threadForBlock(input.blockId);
        if (existing && !existing.resolved) {
            return this.reply(existing.id, body, options);
        }
        const now = Date.now();
        const comment: StoryComment = { id: this.newId(), author: this.currentAuthor(), body, createdAt: now };
        const excerpt = input.text ? storyCommentExcerpt(input.text) : "";
        const thread: StoryCommentThread = {
            id: this.newId(),
            storyId: input.storyId,
            sceneId: input.sceneId,
            blockId: input.blockId,
            ...(excerpt ? { excerpt } : {}),
            todo: input.todo === true,
            resolved: false,
            createdAt: now,
            comments: [comment],
        };
        this.commit(thread.id, thread, "storyComments.history.create", options);
        return thread;
    }

    public reply(threadId: string, body: string, options: StoryCommentEditOptions = {}): StoryCommentThread | null {
        const thread = this.getThread(threadId);
        const text = body.trim();
        if (!thread || !text) {
            return null;
        }
        const comment: StoryComment = { id: this.newId(), author: this.currentAuthor(), body: text, createdAt: Date.now() };
        const next: StoryCommentThread = { ...thread, comments: [...thread.comments, comment] };
        this.commit(threadId, next, "storyComments.history.reply", options);
        return next;
    }

    public editComment(threadId: string, commentId: string, body: string, options: StoryCommentEditOptions = {}): boolean {
        const thread = this.getThread(threadId);
        const text = body.trim();
        const target = thread?.comments.find(comment => comment.id === commentId);
        if (!thread || !target || !text || target.body === text) {
            return false;
        }
        const next: StoryCommentThread = {
            ...thread,
            comments: thread.comments.map(comment => (comment.id === commentId ? { ...comment, body: text, editedAt: Date.now() } : comment)),
        };
        this.commit(threadId, next, "storyComments.history.edit", options);
        return true;
    }

    /** Remove one comment. Removing the only comment removes the thread. */
    public deleteComment(threadId: string, commentId: string, options: StoryCommentEditOptions = {}): boolean {
        const thread = this.getThread(threadId);
        if (!thread || !thread.comments.some(comment => comment.id === commentId)) {
            return false;
        }
        const comments = thread.comments.filter(comment => comment.id !== commentId);
        if (comments.length === 0) {
            return this.deleteThread(threadId, options);
        }
        this.commit(threadId, { ...thread, comments }, "storyComments.history.deleteComment", options);
        return true;
    }

    public deleteThread(threadId: string, options: StoryCommentEditOptions = {}): boolean {
        if (!this.getThread(threadId)) {
            return false;
        }
        this.commit(threadId, null, "storyComments.history.deleteThread", options);
        return true;
    }

    public setResolved(threadId: string, resolved: boolean, options: StoryCommentEditOptions = {}): boolean {
        const thread = this.getThread(threadId);
        if (!thread || thread.resolved === resolved) {
            return false;
        }
        const { resolvedBy: _by, resolvedAt: _at, ...rest } = thread;
        const next: StoryCommentThread = resolved
            ? { ...rest, resolved: true, resolvedBy: this.currentAuthor(), resolvedAt: Date.now() }
            : { ...rest, resolved: false };
        this.commit(threadId, next, resolved ? "storyComments.history.resolve" : "storyComments.history.reopen", options);
        return true;
    }

    public setTodo(threadId: string, todo: boolean, options: StoryCommentEditOptions = {}): boolean {
        const thread = this.getThread(threadId);
        if (!thread || thread.todo === todo) {
            return false;
        }
        this.commit(threadId, { ...thread, todo }, todo ? "storyComments.history.markTodo" : "storyComments.history.clearTodo", options);
        return true;
    }

    /**
     * Point an orphaned thread at a row again: the row it was about was re-written rather than kept,
     * and the author says which line it now belongs to.
     */
    public reanchor(
        threadId: string,
        target: { storyId: string; sceneId: string; blockId: string; text?: string },
        options: StoryCommentEditOptions = {},
    ): boolean {
        const thread = this.getThread(threadId);
        if (!thread) {
            return false;
        }
        const excerpt = target.text ? storyCommentExcerpt(target.text) : thread.excerpt;
        const next: StoryCommentThread = {
            ...thread,
            storyId: target.storyId,
            sceneId: target.sceneId,
            blockId: target.blockId,
            ...(excerpt ? { excerpt } : {}),
        };
        this.commit(threadId, next, "storyComments.history.reanchor", options);
        return true;
    }

    /** Write out anything the auto-save timer still owes, and wait for it. */
    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public dispose(): void {
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        this.unsubscribers = [];
    }

    /* ------------------------------------------------------------------------------- internals */

    /** Put one thread (or its absence) in place, and leave a step that puts the old one back. */
    private commit(threadId: string, next: StoryCommentThread | null, labelKey: TranslationKey, options: StoryCommentEditOptions): void {
        const before = this.getThread(threadId);
        this.write(threadId, next);
        try {
            this.getContext().services.get<HistoryService>(Services.History).pushCommand(options.scopeId ?? projectHistoryScope(), {
                label: { key: labelKey },
                undo: () => this.write(threadId, before),
                redo: () => this.write(threadId, next),
            });
        } catch {
            // No history in this context (a test that never registered it); the edit itself stands.
        }
    }

    private write(threadId: string, thread: StoryCommentThread | null): void {
        const document = this.getDocument();
        const threads = { ...document.threads };
        if (thread) {
            threads[threadId] = thread;
        } else {
            delete threads[threadId];
        }
        this.document = { ...document, threads };
        this.revision += 1;
        this.reindex();
        this.autoSaver.schedule();
        this.events.emit("changed", undefined);
    }

    private reindex(): void {
        const next = new Map<string, StoryCommentThread>();
        for (const thread of Object.values(this.document?.threads ?? {})) {
            const current = next.get(thread.blockId);
            if (!current || storyCommentThreadOutranks(thread, current)) {
                next.set(thread.blockId, thread);
            }
        }
        this.byBlock = next;
    }

    private currentAuthor(): StoryCommentAuthor {
        return this.author ?? { name: "" };
    }

    /**
     * Who is writing: the Team account this project is signed in with, otherwise the name that signs
     * revisions. Empty when neither is set; the interface names that case and points at the setting.
     */
    private async refreshAuthor(): Promise<StoryCommentAuthor> {
        let next: StoryCommentAuthor | null = null;
        try {
            const vcs = this.getContext().services.get<VersionControlService>(Services.VersionControl);
            const session = await vcs.getServerSession();
            if (session) {
                const name = session.account.displayName || session.account.username;
                if (name) next = { name, teamUserId: session.account.userId };
            }
        } catch {
            // No version control, or no reachable store: fall through to the local name.
        }
        if (!next) {
            try {
                const result = await getInterface().app.state.getGlobalState(LOCAL_AUTHOR_SETTING);
                const value: unknown = result.success ? result.data.value : undefined;
                const name = typeof value === "string" ? value.trim() : "";
                next = { name };
            } catch {
                next = { name: "" };
            }
        }
        const changed = this.author?.name !== next.name || this.author?.teamUserId !== next.teamUserId;
        this.author = next;
        if (changed) this.events.emit("authorChanged", next);
        return next;
    }

    private newId(): string {
        return globalThis.crypto.randomUUID();
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext(), storeWrite(STORE_LABEL, "retried"));
    }
}

/** Which of two threads on one row the row shows: open before resolved, then newer before older. */
export function storyCommentThreadOutranks(candidate: StoryCommentThread, current: StoryCommentThread): boolean {
    if (candidate.resolved !== current.resolved) {
        return !candidate.resolved;
    }
    return candidate.createdAt > current.createdAt;
}
