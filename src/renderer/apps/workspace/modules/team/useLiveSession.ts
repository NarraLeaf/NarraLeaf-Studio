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
    join: (input: { session: TeamLiveSession | string }) => void;
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

/** One document a session could be opened on. */
export type LiveSessionStory = { id: StoryId; name: string };

/** What this project offers a session, and which of them is offered first. */
export type LiveSessionStories = {
    all: readonly LiveSessionStory[];
    /** The project's default story, or the first one, or null for a project with none. */
    suggested: StoryId | null;
};

const NO_STORIES: LiveSessionStories = { all: [], suggested: null };

/**
 * The documents a session **opened from this window** could be about.
 *
 * **Opening only.** A room carries the story it is about, so joining one reads that rather than
 * asking here - which is the whole point: a joiner that worked the document out for itself could
 * only ever arrive at one it already holds.
 *
 * The whole library rather than one document, because which one a room is opened on is a decision
 * the author makes and everybody else in the room lives with. `suggested` is where the picker
 * starts, and it is the same answer the panel used to take without asking.
 *
 * Read once when the surface showing it mounts. The library is a project-lifetime fact and the
 * dialog is opened, read and closed.
 */
export function useLiveSessionStories(): LiveSessionStories {
    const { context, isInitialized } = useWorkspace();
    const [library, setLibrary] = useState<LiveSessionStories>(NO_STORIES);

    useEffect(() => {
        if (!context || !isInitialized) {
            setLibrary(NO_STORIES);
            return;
        }
        try {
            const stories = context.services.get<StoryService>(Services.Story);
            const all = stories.listStories().map(one => ({ id: one.id, name: one.name }));
            const preferred = stories.getDefaultStoryId();
            const suggested = all.find(one => one.id === preferred)?.id ?? all[0]?.id ?? null;
            // Kept only where it would answer differently. The library is read from a value that is
            // rebuilt rather than mutated, so writing a fresh object back on every read would
            // re-render every surface holding this for a library that had not changed.
            setLibrary(previous => (sameLibrary(previous, all) && previous.suggested === suggested
                ? previous
                : { all, suggested }));
        } catch {
            // A library this window has not read is a project no session can be opened on, which
            // the control renders as the same refusal an empty one does.
            setLibrary(NO_STORIES);
        }
    }, [context, isInitialized]);

    return library;
}

/** Whether two readings of the library name the same documents, in the same order. */
function sameLibrary(previous: LiveSessionStories, next: readonly LiveSessionStory[]): boolean {
    return previous.all.length === next.length
        && previous.all.every((one, index) => one.id === next[index].id && one.name === next[index].name);
}

/**
 * The room on this project that this window could join, or null.
 *
 * ⚠ **A room this window has just closed is not one of them, and it has to be excluded by name.**
 * The list comes from the server and the session's own state does not, so between ending a room and
 * the server's news of it coming back round there is a stretch in which this window is in no
 * session and the closed room is still in `team.live`. Matching only against the session this
 * window is in reads that stretch as "somebody else's room, two people in it, press to join" -
 * which is what a host saw on a real machine the instant they pressed End.
 *
 * ⚠ **`ended.closed` answers that and `ended.cause` does not.** `left` is true of a guest walking
 * out of a room that carries on and of a host closing one, and those are opposite answers to the
 * only question asked here.
 *
 * Reads the server again when a session ends in this window. The room list changed because of
 * something this window did, and the server says so on a topic this project is subscribed to - but
 * a collection that is only ever corrected by somebody else's news is a collection that stays wrong
 * whenever that news is missed.
 */
export function useJoinableRoom(team: {
    live: readonly TeamLiveSession[];
    refresh: () => void;
}, view: LiveSessionView): TeamLiveSession | null {
    const endedRoom = view.ended?.sessionId ?? null;
    const refresh = team.refresh;
    useEffect(() => {
        if (endedRoom === null) {
            return;
        }
        refresh();
    }, [endedRoom, refresh]);

    const rooms = team.live;
    const mine = view.session?.id ?? null;
    const gone = view.ended?.closed === true ? view.ended.sessionId : null;
    return useMemo(
        () => rooms.find(session => session.id !== mine && session.id !== gone) ?? null,
        [rooms, mine, gone],
    );
}
