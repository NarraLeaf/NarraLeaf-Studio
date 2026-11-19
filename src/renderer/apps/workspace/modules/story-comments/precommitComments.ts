import { useMemo } from "react";

import type { StoryCommentThread } from "@shared/types/storyComments";

import { useStoryCommentThreads } from "./storyCommentsState";

/** Where a story's files live, repository-relative: `editor/story/stories/<storyId>/…`. */
const STORY_FILE = /^editor\/story\/stories\/([^/]+)\//;

/** The stories a set of changed paths touches. Backslashes are read as separators. */
export function storiesTouched(paths: readonly string[]): Set<string> {
    const stories = new Set<string>();
    for (const raw of paths) {
        const match = STORY_FILE.exec(raw.replace(/\\/g, "/"));
        if (match?.[1]) stories.add(match[1]);
    }
    return stories;
}

/**
 * The open comment threads in the stories a commit is about to record.
 *
 * Resolved threads and threads in stories this commit does not touch are left out.
 */
export function openThreadsInChanges(threads: readonly StoryCommentThread[], paths: readonly string[]): StoryCommentThread[] {
    const touched = storiesTouched(paths);
    if (touched.size === 0) return [];
    return threads.filter(thread => !thread.resolved && touched.has(thread.storyId));
}

/** {@link openThreadsInChanges}, kept current as threads are written and resolved. */
export function useOpenThreadsInChanges(paths: readonly string[] | null): StoryCommentThread[] {
    const threads = useStoryCommentThreads();
    return useMemo(() => paths === null ? [] : openThreadsInChanges(threads, paths), [threads, paths]);
}
