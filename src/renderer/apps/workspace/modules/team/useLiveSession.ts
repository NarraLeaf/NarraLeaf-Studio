import { useCallback, useEffect, useMemo, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StoryId } from "@shared/types/story";
import type { TeamLiveSession } from "@shared/types/team";
import { useWorkspace } from "../../context";

/**
 * The live session this window is in, as React state, plus the three acts that change it.
 *
 * **Read whole, from one subscription.** `LiveSessionView` changes as one thing - a message
 * arrives, a phase moves, the room ends - and a panel drawing from several readers would show
 * several moments of it at once.
 *
 * Everything the panel says is composed from that value here or above it. The service deliberately
 * produces no sentences, so the mapping from a fact to a string belongs to whichever surface is
 * showing it.
 */

/** What a session-driving surface holds. */
export type LiveSessionSurface = {
    view: LiveSessionView;
    /**
     * Whether one of the acts is still running.
     *
     * `phase` says the same thing for most of a session's life, but not for the gap between a
     * control being pressed and the service publishing `entering` - which is where a second press
     * would land.
     */
    busy: boolean;
    open: (input: { storyId: StoryId; title?: string }) => void;
    join: (input: { session: TeamLiveSession | string; storyId: StoryId }) => void;
    leave: () => void;
};

export function useLiveSession(): LiveSessionSurface {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );
    const [view, setView] = useState<LiveSessionView>(IDLE_LIVE_SESSION);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!service) {
            setView(IDLE_LIVE_SESSION);
            return;
        }
        // Read on the way in as well as on every change: a panel mounted during a session has
        // missed the event that started it.
        setView(service.getView());
        return service.onChanged(setView);
    }, [service]);

    const run = useCallback((act: (session: LiveSessionService) => Promise<unknown>) => {
        if (!service) {
            return;
        }
        setBusy(true);
        void act(service).finally(() => setBusy(false));
    }, [service]);

    return {
        view,
        busy,
        open: useCallback(input => run(session => session.open(input)), [run]),
        join: useCallback(input => run(session => session.join(input)), [run]),
        leave: useCallback(() => run(session => session.leave()), [run]),
    };
}

/**
 * The story a session opened from this window would be about, or null for a project with none.
 *
 * **The project's default story, and there is no picker.** A room carries no story id
 * (`TeamLiveSession`), so the two windows in it can only be about the same document by both
 * working it out the same way - and a list to choose from would be a way for them to disagree.
 * The default story is the one answer every window in the project computes identically.
 *
 * Read once when the surface showing it mounts. The library is a project-lifetime fact and the
 * panel is opened, read and closed.
 */
export function useLiveSessionStory(): { id: StoryId; name: string } | null {
    const { context, isInitialized } = useWorkspace();
    const [story, setStory] = useState<{ id: StoryId; name: string } | null>(null);

    useEffect(() => {
        if (!context || !isInitialized) {
            setStory(null);
            return;
        }
        try {
            const stories = context.services.get<StoryService>(Services.Story);
            const library = stories.listStories();
            const preferred = stories.getDefaultStoryId();
            const entry = library.find(one => one.id === preferred) ?? library[0];
            // Kept only where it would answer differently. The library is read from a value that
            // is rebuilt rather than mutated, so writing a fresh object back on every read would
            // re-render the panel for a story that had not changed.
            setStory(previous => (previous?.id === entry?.id && previous?.name === entry?.name
                ? previous
                : entry ? { id: entry.id, name: entry.name } : null));
        } catch {
            // A library this window has not read is a project no session can be opened on, which
            // the control renders as the same refusal an empty one does.
            setStory(null);
        }
    }, [context, isInitialized]);

    return story;
}
