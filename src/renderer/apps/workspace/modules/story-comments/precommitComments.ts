import { useEffect, useMemo, useState } from "react";

import type { StoryCommentThread } from "@shared/types/storyComments";

import { useStoryCommentsService } from "./storyCommentsState";

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
 * Said before the commit, not as a gate: an open question on a line that is being changed is
 * worth a glance, and often the change is the answer. Resolved threads and threads in stories
 * this commit does not touch are left out.
 */
export function openThreadsInChanges(threads: readonly StoryCommentThread[], paths: readonly string[]): StoryCommentThread[] {
    const touched = storiesTouched(paths);
    if (touched.size === 0) return [];
    return threads.filter(thread => !thread.resolved && touched.has(thread.storyId));
}

/** {@link openThreadsInChanges}, kept current as threads are written and resolved. */
export function useOpenThreadsInChanges(paths: readonly string[] | null): StoryCommentThread[] {
    const service = useStoryCommentsService();
    const [version, setVersion] = useState(0);
    useEffect(() => service?.onChanged(() => setVersion(current => current + 1)), [service]);
    return useMemo(() => {
        void version; // the service saying its threads moved
        return service === null || paths === null ? [] : openThreadsInChanges(service.listThreads(), paths);
    }, [service, paths, version]);
}
