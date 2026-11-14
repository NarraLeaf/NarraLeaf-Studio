/**
 * Review comments on story rows - the project's `editor/story-comments.json`.
 *
 * A thread is a conversation about one row of one scene: who said what and when, whether the point
 * was settled, and whether it is work still to do. It is review material ABOUT the script, never part
 * of it, so it lives in a document of its own rather than in the story document. Three things follow
 * from that, and each is the reason for the choice:
 *
 *  - **Nothing ships.** The story compiler reads story documents; this file is not one, so no build,
 *    no lint rule and no word count can ever pick a comment up as dialogue.
 *  - **The story schema is untouched.** A comment is not something an older Studio has to refuse a
 *    story over, and two people commenting on the same scene are not editing the scene.
 *  - **It still travels with the project.** It sits in `editor/`, which version control tracks, so a
 *    teammate pulling the project gets the threads the same way they get the script.
 *
 * A thread is anchored by the row's block id. Block ids are UUIDs and survive every edit that keeps
 * the row (re-ordering, moving it into another scene, undoing its deletion), so the lookup the editor
 * does is by block id alone; `storyId`/`sceneId` are where the row was last known to be, which is what
 * the comments panel falls back to when the row cannot be found any more. A thread whose row is gone
 * is an *orphan*: it is kept, listed under its old scene, and carries an excerpt of the line so it
 * still says what it was about.
 *
 * Comments in English per project convention.
 */

/** Persisted document version. Independent of every other document. */
export const STORY_COMMENTS_SCHEMA_VERSION = 1;

/** Longest excerpt of the row kept on a thread. Enough to recognise the line, not to quote it. */
export const STORY_COMMENT_EXCERPT_MAX = 120;

/**
 * Who wrote a comment.
 *
 * `name` is what is shown. `teamUserId` is the Team account the name came from, when there was one;
 * it is kept so two people who happen to set the same local name are still two authors to a filter
 * that wants to tell them apart, and so a renamed account is still recognisably the same person.
 */
export type StoryCommentAuthor = {
    name: string;
    teamUserId?: string;
};

/** One message in a thread. */
export type StoryComment = {
    id: string;
    author: StoryCommentAuthor;
    body: string;
    /** Epoch ms. */
    createdAt: number;
    /** Epoch ms of the last edit, absent when the comment was never edited. */
    editedAt?: number;
    /**
     * The id this comment has on the project's Team server, once it is there. Absent for a comment
     * that has not been sent - or one written where no server is - which is what the sync looks for.
     * Additive: an older Studio drops it on save, and the next sync finds the comment again by the
     * client id it was sent with rather than sending it twice.
     */
    teamCommentId?: string;
};

/** A conversation about one story row. */
export type StoryCommentThread = {
    id: string;
    storyId: string;
    sceneId: string;
    blockId: string;
    /** The row's text when the thread was opened, so an orphaned thread still says what it was about. */
    excerpt?: string;
    /** Marked as work still to do on the row. Independent of {@link resolved}. */
    todo: boolean;
    resolved: boolean;
    resolvedBy?: StoryCommentAuthor;
    /** Epoch ms. */
    resolvedAt?: number;
    /** Epoch ms. */
    createdAt: number;
    /** Oldest first. Never empty in a document Studio wrote. */
    comments: StoryComment[];
    /** The thread's id on the project's Team server, once it is there. See {@link StoryComment.teamCommentId}. */
    teamThreadId?: string;
    /**
     * The Team to-do this thread's {@link todo} mark became, once it is there: a project to-do
     * anchored to the same row, which the web console's board shows and can assign.
     */
    teamTodoId?: string;
};

/**
 * The persisted document.
 *
 * Threads are a map keyed by id rather than a list, so two people opening threads on different rows
 * change two different keys of the canonical JSON - which version control can put side by side
 * without either of them being asked which list order wins.
 */
export type StoryCommentsDocument = {
    schemaVersion: number;
    threads: Record<string, StoryCommentThread>;
};

export function createEmptyStoryCommentsDocument(): StoryCommentsDocument {
    return { schemaVersion: STORY_COMMENTS_SCHEMA_VERSION, threads: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAuthor(value: unknown): StoryCommentAuthor | null {
    if (!isRecord(value) || typeof value.name !== "string") {
        return null;
    }
    const author: StoryCommentAuthor = { name: value.name };
    if (typeof value.teamUserId === "string" && value.teamUserId) {
        author.teamUserId = value.teamUserId;
    }
    return author;
}

function normalizeComment(value: unknown): StoryComment | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.body !== "string") {
        return null;
    }
    const author = normalizeAuthor(value.author);
    if (!author) {
        return null;
    }
    const comment: StoryComment = {
        id: value.id,
        author,
        body: value.body,
        createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    };
    if (typeof value.editedAt === "number") {
        comment.editedAt = value.editedAt;
    }
    if (typeof value.teamCommentId === "string" && value.teamCommentId) {
        comment.teamCommentId = value.teamCommentId;
    }
    return comment;
}

/**
 * One thread as it is stored, or null for something no Studio wrote.
 *
 * A thread with no readable comment is dropped: it would be a mark on a row that opens onto nothing.
 */
export function normalizeStoryCommentThread(value: unknown): StoryCommentThread | null {
    if (!isRecord(value)) {
        return null;
    }
    const { id, storyId, sceneId, blockId } = value;
    if (typeof id !== "string" || typeof storyId !== "string" || typeof sceneId !== "string" || typeof blockId !== "string") {
        return null;
    }
    const comments = Array.isArray(value.comments)
        ? value.comments.map(normalizeComment).filter((comment): comment is StoryComment => comment !== null)
        : [];
    if (comments.length === 0) {
        return null;
    }
    const thread: StoryCommentThread = {
        id,
        storyId,
        sceneId,
        blockId,
        todo: value.todo === true,
        resolved: value.resolved === true,
        createdAt: typeof value.createdAt === "number" ? value.createdAt : comments[0].createdAt,
        comments,
    };
    if (typeof value.excerpt === "string" && value.excerpt) {
        thread.excerpt = value.excerpt.slice(0, STORY_COMMENT_EXCERPT_MAX);
    }
    if (typeof value.teamThreadId === "string" && value.teamThreadId) {
        thread.teamThreadId = value.teamThreadId;
    }
    if (typeof value.teamTodoId === "string" && value.teamTodoId) {
        thread.teamTodoId = value.teamTodoId;
    }
    if (thread.resolved) {
        const resolvedBy = normalizeAuthor(value.resolvedBy);
        if (resolvedBy) {
            thread.resolvedBy = resolvedBy;
        }
        if (typeof value.resolvedAt === "number") {
            thread.resolvedAt = value.resolvedAt;
        }
    }
    return thread;
}

/** The document as it is stored, with anything unreadable left out. */
export function normalizeStoryCommentsDocument(raw: Record<string, unknown>): StoryCommentsDocument {
    const threads: Record<string, StoryCommentThread> = {};
    if (isRecord(raw.threads)) {
        for (const [key, value] of Object.entries(raw.threads)) {
            const thread = normalizeStoryCommentThread(value);
            // The key is the identity; a thread whose own id disagrees takes the key's.
            if (thread) {
                threads[key] = { ...thread, id: key };
            }
        }
    }
    return { schemaVersion: STORY_COMMENTS_SCHEMA_VERSION, threads };
}

/** A row's text cut down to an excerpt: one line, trimmed, at most {@link STORY_COMMENT_EXCERPT_MAX}. */
export function storyCommentExcerpt(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > STORY_COMMENT_EXCERPT_MAX ? `${flat.slice(0, STORY_COMMENT_EXCERPT_MAX - 1)}…` : flat;
}

/** The key two authors are told apart by: the Team account when there is one, otherwise the name. */
export function storyCommentAuthorKey(author: StoryCommentAuthor): string {
    return author.teamUserId ? `team:${author.teamUserId}` : `name:${author.name}`;
}

/** Every author who wrote in a thread, in order of first appearance, once each. */
export function storyCommentThreadAuthors(thread: StoryCommentThread): StoryCommentAuthor[] {
    const seen = new Set<string>();
    const authors: StoryCommentAuthor[] = [];
    for (const comment of thread.comments) {
        const key = storyCommentAuthorKey(comment.author);
        if (!seen.has(key)) {
            seen.add(key);
            authors.push(comment.author);
        }
    }
    return authors;
}
