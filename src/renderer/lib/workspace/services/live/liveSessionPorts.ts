import type { TeamOutcome } from "@/lib/team";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import type { LiveDerived, LiveOp } from "@shared/live/ops";
import type { StoryDocument, StoryId } from "@shared/types/story";
import type { TeamLiveEvent, TeamLiveSession } from "@shared/types/team";
import type { StoryOpSink } from "../story/StoryService";

/**
 * Everything a live session needs from the workspace it is running in, and nothing it needs to know
 * how to reach.
 *
 * The same discipline the pure half of the feature is built on: `LiveHost` and `LiveGuest` take
 * their world as an argument, and the thing that wires them to a real server, a real repository and
 * a real freeze has to be checkable the same way. A session is a sequence - checkpoint, then open,
 * then freeze, then follow - and a sequence that can only be exercised against a Team server, a
 * repository with a remote and a second machine is a sequence nobody can check.
 *
 * Every port below is the narrowest thing that expresses what the session actually does with it.
 * They are deliberately not the services themselves: `VersionControlService` has forty methods and
 * a session uses five of them, and a port that handed over the whole service would make it possible
 * to reach for the other thirty-five without anybody noticing.
 */

/** Which project this window has open, and where it talks about it. */
export type LiveProjectIdentity = {
    /** The repository id - the identity that survives a rename, and what a room is opened on. */
    repositoryId: string;
    /** The project directory. What the freeze is scoped to. */
    projectPath: string;
    /** The Team server's data origin, or null for a project that points at none. */
    remoteOrigin: string | null;
};

/** The rooms on one server, with the origin already baked in. */
export type LiveRooms = {
    list(project: string): Promise<TeamOutcome<TeamLiveSession[]>>;
    open(input: { project: string; revision: string; title?: string }): Promise<TeamOutcome<TeamLiveSession>>;
    join(sessionId: string): Promise<TeamOutcome<TeamLiveSession>>;
    leave(sessionId: string): Promise<TeamOutcome<null>>;
    close(sessionId: string): Promise<TeamOutcome<null>>;
    /**
     * Say one thing to a room.
     *
     * Fire and forget on purpose. Whether a message arrived is not knowable from here - the room
     * keeps nothing and the server routes to whoever is listening at that instant - so the only
     * repair available is the one the guest already implements: send the intent again, unchanged,
     * under the key that makes a second delivery a second reading of one answer.
     */
    say(sessionId: string, payload: unknown): void;
    /**
     * Listen to one room. `from` is the instance the server says sent it, never something the
     * message claims about itself. Returns the unsubscribe.
     */
    listen(sessionId: string, onMessage: (payload: unknown, from: string) => void): () => void;
    /**
     * Watch a project's rooms opening and closing. Returns the unsubscribe.
     *
     * How a guest finds out that the room is gone. The host holds the only copy that counts, so its
     * window leaving ends the session for everybody - and a guest that did not notice would go on
     * sending intents into a room nobody is in, with its own document frozen behind a session that
     * no longer exists.
     */
    watch(project: string, onEvent: (event: TeamLiveEvent) => void): () => void;
};

/** The story document a session is about. */
export type LiveStoryPort = {
    /** Where editing gestures go instead of into the document, or null to take them back. */
    setSink(sink: StoryOpSink | null): void;
    /** The document as it stands, or null when this window does not hold that story. */
    document(storyId: StoryId): StoryDocument | null;
    /** Apply one operation, without consulting the sink. Synchronous, and has to stay that way. */
    applyOp(storyId: StoryId, op: LiveOp): void;
    /**
     * Write the entries an effect derived into the libraries every participant derives them into.
     *
     * Called only while an effect is being applied, which is the only moment those libraries may be
     * written at all during a session - see `holdDerivedProjectWrites`. A path exemption would also
     * let the localization panel write, and that write has no effect behind it for anybody else to
     * derive the same thing from.
     */
    adoptDerived(derived: LiveDerived): void;
};

/** The five things a session asks of version control. */
export type LiveVersionPort = {
    /** Record a checkpoint. The revision it made, or null when there was nothing to record. */
    checkpoint(): Promise<string | null>;
    /** The newest revision, or null in a repository with none. */
    head(): Promise<string | null>;
    /** Whether the working tree holds anything no revision has. */
    hasUncommittedChanges(): Promise<boolean>;
    /** Put this branch on the server, so the revision a room opens on is one others can fetch. */
    push(): Promise<void>;
    /** Bring the working tree up to the server. `conflicts` is what the merge left to a human. */
    sync(): Promise<{ conflicts: readonly string[] }>;
};

/** The write latch, as much of it as a session touches. */
export type LiveFreezePort = {
    /** Why the workspace is frozen, or null. What `refuseLiveSessionEntry` is asked about. */
    reason(): WorkspaceFreezeReason | null;
    /** Flush what is owed, then freeze everything but the paths named. */
    arm(input: { session: string; writable: readonly string[] }): Promise<void>;
    /**
     * Lift the freeze this session armed.
     *
     * Named by session id rather than unconditional: the latch is module-level, and a session that
     * ended while a slower path was still finishing must not be able to lift a freeze that belongs
     * to something else.
     */
    lift(session: string): void;
};

/** The undo stacks, as much of them as a session touches. */
export type LiveHistoryPort = {
    /**
     * Throw away the scene stacks of one story.
     *
     * Every entry in them is a whole-scene snapshot of a document that only this author had. One
     * applied after a session would put that scene back as it was before anybody else joined,
     * deleting everything they wrote, with nothing on either screen reporting it.
     */
    forgetStoryScenes(storyId: StoryId): void;
};

/** Everything {@link LiveSession} needs from the world. */
export type LiveSessionDeps = {
    /** This window's instance id on the server, or null when it has not been given one. */
    instance(): Promise<string | null>;
    /** What this window has open, or null when it has no repository. */
    project(): Promise<LiveProjectIdentity | null>;
    /** The rooms on this project's server. Null where the project points at none. */
    rooms(remoteOrigin: string): LiveRooms;
    story: LiveStoryPort;
    version: LiveVersionPort;
    freeze: LiveFreezePort;
    history: LiveHistoryPort;
    /** The project-relative path of one story document, for the freeze's writable set. */
    storyDocumentPath(storyId: StoryId): string;
    /**
     * Milliseconds from a source that only moves forward, and a delayed run that can be cancelled.
     *
     * The guest's re-send timer hangs off both, and they are injected for the reason the guest's own
     * are: "waited too long" has to be something a test can state in a line rather than sit through.
     */
    now(): number;
    schedule(delayMs: number, run: () => void): () => void;
};
