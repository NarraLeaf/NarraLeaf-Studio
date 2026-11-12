import {
    storyCommentAuthorKey,
    storyCommentThreadAuthors,
    type StoryCommentThread,
} from "@shared/types/storyComments";

/**
 * The comments panel's filtering and grouping, kept apart from React so it can be tested on plain
 * threads. Comments in English per project convention.
 */

export type StoryCommentStatusFilter = "open" | "resolved" | "todo" | "all";

/** Where a thread's row is now, as far as the loaded stories can say. */
export type StoryCommentLocation = {
    /** False when no loaded story holds the row: the thread is an orphan. */
    found: boolean;
    storyId: string;
    sceneId: string;
    storyName: string;
    sceneName: string;
    /** The row's words now, or the excerpt kept on the thread when the row is gone. */
    text: string;
};

export type StoryCommentLocator = (thread: StoryCommentThread) => StoryCommentLocation;

export type StoryCommentFilter = {
    status: StoryCommentStatusFilter;
    /** `storyCommentAuthorKey` of an author who wrote in the thread, or null for anyone. */
    authorKey: string | null;
    query: string;
};

export function matchesStoryCommentStatus(thread: StoryCommentThread, status: StoryCommentStatusFilter): boolean {
    switch (status) {
        case "open":
            return !thread.resolved;
        case "resolved":
            return thread.resolved;
        case "todo":
            // A to-do that has been resolved is done; the filter lists the work still outstanding.
            return thread.todo && !thread.resolved;
        case "all":
            return true;
    }
}

export function filterStoryCommentThreads(
    threads: readonly StoryCommentThread[],
    filter: StoryCommentFilter,
    locate: StoryCommentLocator,
): StoryCommentThread[] {
    const needle = filter.query.trim().toLowerCase();
    return threads.filter(thread => {
        if (!matchesStoryCommentStatus(thread, filter.status)) return false;
        if (filter.authorKey && !storyCommentThreadAuthors(thread).some(author => storyCommentAuthorKey(author) === filter.authorKey)) {
            return false;
        }
        if (needle) {
            const where = locate(thread);
            const haystack = [where.text, where.sceneName, ...thread.comments.map(comment => comment.body)].join("\n").toLowerCase();
            if (!haystack.includes(needle)) return false;
        }
        return true;
    });
}

export type StoryCommentGroup = {
    key: string;
    orphan: boolean;
    storyName: string;
    sceneName: string;
    threads: StoryCommentThread[];
};

/**
 * Threads by the scene their row is in, in the order the threads were opened, with the orphans last
 * in a group of their own.
 */
export function groupStoryCommentThreads(threads: readonly StoryCommentThread[], locate: StoryCommentLocator): StoryCommentGroup[] {
    const groups = new Map<string, StoryCommentGroup>();
    const orphans: StoryCommentThread[] = [];
    for (const thread of threads) {
        const where = locate(thread);
        if (!where.found) {
            orphans.push(thread);
            continue;
        }
        const key = `${where.storyId}:${where.sceneId}`;
        let group = groups.get(key);
        if (!group) {
            group = { key, orphan: false, storyName: where.storyName, sceneName: where.sceneName, threads: [] };
            groups.set(key, group);
        }
        group.threads.push(thread);
    }
    const result = [...groups.values()];
    if (orphans.length > 0) {
        result.push({ key: "orphans", orphan: true, storyName: "", sceneName: "", threads: orphans });
    }
    return result;
}
