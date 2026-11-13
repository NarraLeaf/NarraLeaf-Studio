import { useCallback, useSyncExternalStore } from "react";
import type { StoryCommentAuthor, StoryCommentThread } from "@shared/types/storyComments";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { StoryCommentsService } from "@/lib/workspace/services/storyComments/StoryCommentsService";
import type { UIService } from "@/lib/workspace/services/core/UIService";

export const STORY_COMMENTS_PANEL_ID = "narraleaf-studio:story-comments";

/** The comments service of this window, or null outside one (a test, a window that never loaded it). */
export function storyCommentsServiceOf(context: WorkspaceContext | null | undefined): StoryCommentsService | null {
    if (!context) {
        return null;
    }
    try {
        return context.services.get<StoryCommentsService>(Services.StoryComments);
    } catch {
        return null;
    }
}

/**
 * The service, read without throwing outside a workspace.
 *
 * `useOptionalWorkspace` rather than `useWorkspace()`: a story row is rendered by tests that mount no
 * provider, and a mark that cannot find comments has nothing to show rather than a reason to crash.
 */
export function useStoryCommentsService(): StoryCommentsService | null {
    const value = useOptionalWorkspace();
    return storyCommentsServiceOf(value?.context);
}

const noopSubscribe = () => () => undefined;

/** The thread a row shows, or null; re-renders only when that thread object changes. */
export function useStoryCommentThreadForBlock(blockId: string): StoryCommentThread | null {
    const service = useStoryCommentsService();
    const subscribe = useCallback((notify: () => void) => service?.onChanged(notify) ?? (() => undefined), [service]);
    return useSyncExternalStore(
        service ? subscribe : noopSubscribe,
        () => service?.threadForBlock(blockId) ?? null,
        () => null,
    );
}

/** Every thread, as of the last change. The array keeps its identity until something moves. */
export function useStoryCommentThreads(): readonly StoryCommentThread[] {
    const service = useStoryCommentsService();
    const subscribe = useCallback((notify: () => void) => service?.onChanged(notify) ?? (() => undefined), [service]);
    const revision = useSyncExternalStore(service ? subscribe : noopSubscribe, () => service?.getRevision() ?? -1, () => -1);
    return threadsAt(service, revision);
}

let threadCache: { service: StoryCommentsService | null; revision: number; threads: readonly StoryCommentThread[] } | null = null;

function threadsAt(service: StoryCommentsService | null, revision: number): readonly StoryCommentThread[] {
    if (threadCache && threadCache.service === service && threadCache.revision === revision) {
        return threadCache.threads;
    }
    const threads = service?.listThreads() ?? [];
    threadCache = { service, revision, threads };
    return threads;
}

/** The name new comments are signed with. */
export function useStoryCommentAuthor(): StoryCommentAuthor | null {
    const service = useStoryCommentsService();
    const subscribe = useCallback((notify: () => void) => service?.onAuthorChanged(notify) ?? (() => undefined), [service]);
    return useSyncExternalStore(service ? subscribe : noopSubscribe, () => service?.getAuthor() ?? null, () => null);
}

/* ------------------------------------------------------------ which row's thread is open */

/**
 * The row whose thread popover is open, at most one per window.
 *
 * A module store rather than editor state: the popover is opened from three places - the row's own
 * mark, the row menu's "Add comment", and the comments panel - and only the row can draw it, because
 * only the row knows where it is on screen.
 */
export type StoryCommentPopoverTarget = { storyId: string; sceneId: string; blockId: string; text?: string };

let popoverTarget: StoryCommentPopoverTarget | null = null;
const popoverListeners = new Set<() => void>();

function emitPopover(): void {
    for (const listener of popoverListeners) listener();
}

function subscribePopover(listener: () => void): () => void {
    popoverListeners.add(listener);
    return () => popoverListeners.delete(listener);
}

export function openStoryCommentPopover(target: StoryCommentPopoverTarget): void {
    popoverTarget = target;
    emitPopover();
}

export function closeStoryCommentPopover(blockId?: string): void {
    if (blockId !== undefined && popoverTarget?.blockId !== blockId) {
        return;
    }
    popoverTarget = null;
    emitPopover();
}

/** The open target when it is this row's, otherwise null - so only two rows re-render per change. */
export function useStoryCommentPopoverFor(blockId: string): StoryCommentPopoverTarget | null {
    return useSyncExternalStore(
        subscribePopover,
        () => (popoverTarget?.blockId === blockId ? popoverTarget : null),
        () => null,
    );
}

/** Show the comments panel. */
export function openStoryCommentsPanel(context: WorkspaceContext): void {
    const uiService = context.services.get<UIService>(Services.UI);
    uiService.panels.show(STORY_COMMENTS_PANEL_ID);
}
