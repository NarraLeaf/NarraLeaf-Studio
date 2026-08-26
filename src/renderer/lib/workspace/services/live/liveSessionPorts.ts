import type { TeamOutcome } from "@/lib/team";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import type { LiveCastView } from "@shared/live/cast";
import type {
    LiveAssetFolder,
    LiveAssetFolderOp,
    LiveAssetOp,
    LiveAssetRecord,
    LiveCharacterOp,
    LiveDerived,
    LiveDialogueRowRef,
    LiveDigestScope,
    LiveLocalizationKeyOp,
    LiveLocalizationOp,
    LiveStoryOp,
    LiveVariableOp,
    LiveVoiceOp,
} from "@shared/live/ops";
import type { LocalizationKeyDefinition, LocalizationUnit } from "@shared/types/localization";
import type { StoryDocument, StoryId } from "@shared/types/story";
import type { TeamLiveEvent, TeamLiveSession } from "@shared/types/team";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import type { VoiceUnit } from "@shared/types/voice";
import type { AssetBlobPort, AssetOpSink } from "../core/AssetsService";
import type { CharacterOpSink } from "../core/CharacterService";
import type { LocalizationOpSink } from "../localization/LocalizationService";
import type { StoryOpSink } from "../story/StoryService";
import type { VariableOpSink } from "../variables/VariableRegistryService";
import type { VoiceOpSink } from "../voice/VoiceService";

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
    open(input: {
        project: string;
        revision: string;
        /** The story document the room is about. Required by the server; see {@link TeamLiveSession}. */
        story: string;
        title?: string;
    }): Promise<TeamOutcome<TeamLiveSession>>;
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

/**
 * The story documents a session carries - all of them.
 *
 * A session is opened on one story and that is still the only one anybody is expected to be editing.
 * It carries the rest because one gesture reaches them: deleting a character rewrites the dialogue
 * rows that spoke it, wherever the author put them. See `@shared/live/sharedDocuments`.
 */
export type LiveStoryPort = {
    /** Every story in the project. What the freeze's writable set and the host's document check read. */
    listStories(): readonly StoryId[];
    /**
     * Read every story document into memory, and say which ones could not be read.
     *
     * Called once, on the way into a session. Story documents are loaded lazily in an ordinary
     * workspace, and a machine that never opened a story would be unable to apply a sweep that
     * reaches it - appliers are synchronous, so there is no moment later at which one could be
     * fetched. Paid here, alongside a whole-project synchronisation that costs far more.
     */
    loadAll(): Promise<readonly StoryId[]>;
    /**
     * Which dialogue rows one character speaks, across every story this machine holds.
     *
     * Read before a deletion is handed over, because it is the only moment those rows still say whose
     * they are - afterwards they hold a bare name, and a name is not an identifier.
     */
    rowsSpokenBy(characterId: string): readonly LiveDialogueRowRef[];
    /** Where editing gestures go instead of into the document, or null to take them back. */
    setSink(sink: StoryOpSink | null): void;
    /** The document as it stands, or null when this window does not hold that story. */
    document(storyId: StoryId): StoryDocument | null;
    /** Apply one operation, without consulting the sink. Synchronous, and has to stay that way. */
    applyOp(storyId: StoryId, op: LiveStoryOp): void;
    /**
     * Write the entries an effect derived into the libraries every participant derives them into.
     *
     * Called only while an effect is being applied, which is the only moment those libraries may be
     * written at all during a session - see `holdDerivedProjectWrites`. A path exemption would also
     * let the localization panel write, and that write has no effect behind it for anybody else to
     * derive the same thing from.
     */
    adoptDerived(derived: LiveDerived): readonly LiveDigestScope[];
};

/**
 * One language's translations, and the same three things any shared document has to provide.
 *
 * **Per language rather than per project**, which is the shape the story port has and the cast port
 * does not: `editor/localization/<locale>.json` is one file per language, so a session carries as
 * many of them as it managed to read.
 */
export type LiveLocalizationPort = {
    /** Where translation edits go instead of into the library, or null to take them back. */
    setSink(sink: LocalizationOpSink | null): void;
    /**
     * Read every language's library into memory, and answer with the ones that could be read.
     *
     * Called once, on the way into a session, for `LiveStoryPort.loadAll`'s reason: appliers are
     * synchronous, and a library that is not in memory when the session starts is one no effect can
     * ever reach. What comes back is what the session carries and what the freeze leaves writable -
     * one set, from one call.
     */
    loadAll(): Promise<readonly string[]>;
    /** One language's entries as they stand, or null when this window does not hold them. */
    units(locale: string): Readonly<Record<string, LocalizationUnit>> | null;
    /**
     * Read the named-string registry, and say whether this window holds it.
     *
     * ⚠ **A second document on one port**, which no other kind here does, and it is the same service
     * owning both: `editor/localization/keys.json` holds the source texts the per-language libraries
     * are translations of. They are addressed apart everywhere it matters - their own `LiveDocument`,
     * their own digest, their own claim - so what they share is a sink and a port, not an identity.
     */
    loadKeys(): Promise<boolean>;
    /** Every named string as it stands, or null when this window does not hold the registry. */
    keys(): Readonly<Record<string, LocalizationKeyDefinition>> | null;
    /** Apply one operation, without consulting the sink. Synchronous, and has to stay that way. */
    applyOp(op: LiveLocalizationOp | LiveLocalizationKeyOp): void;
};

/**
 * The project's variable registry - `editor/variables.json`.
 *
 * The cast port's shape rather than a library's: there is one registry per project, so nothing here
 * is parameterised and there is no set of them to load. What it does have that the cast does not is
 * {@link readable}, because the registry survives a document it could not parse - the service keeps
 * an empty stand-in so the project still opens, and a session that carried THAT would be applying
 * operations to a registry with nothing to do with the file on disk.
 *
 * ⚠ **Nothing here removes an entry.** Deleting a variable also clears the params of every blueprint
 * node that named it, and the blueprint document is not a document a session carries -
 * `VariableRegistryService` refuses the gesture for as long as a sink is installed.
 */
export type LiveVariablesPort = {
    /** Where registry edits go instead of into the registry, or null to take them back. */
    setSink(sink: VariableOpSink | null): void;
    /** Whether this window holds a registry it could actually read. */
    readable(): boolean;
    /** One entry as it stands, or null when there is none. Read for a digest and for an inverse. */
    entry(variableId: string): VariableRegistryEntry | null;
    /** Apply one operation, without consulting the sink. Synchronous, for the story port's reason. */
    applyOp(op: LiveVariableOp): void;
};

/** One language's voice takes. The translations port's mirror, method for method. */
export type LiveVoicePort = {
    setSink(sink: VoiceOpSink | null): void;
    loadAll(): Promise<readonly string[]>;
    units(locale: string): Readonly<Record<string, VoiceUnit>> | null;
    applyOp(op: LiveVoiceOp): void;
};

/**
 * The cast, the second document a session carries.
 *
 * Three methods against the story port's five, and the difference is the whole of what a document has
 * to provide to be shared: somewhere for its edits to go, a way to read it, and an applier that does
 * not consult the sink. The story port's extra two are the derived libraries, which the cast has
 * none of - a character derives nothing that anybody else has to write.
 */
export type LiveCastPort = {
    /** Where cast edits go instead of into the store, or null to take them back. */
    setSink(sink: CharacterOpSink | null): void;
    /** The cast as it stands. Read for a digest, and for what an inverse has to be built against. */
    view(): LiveCastView;
    /**
     * Apply one operation, without consulting the sink. Synchronous, for the story port's reason.
     *
     * Answers with every unit it changed beyond the one the operation names - the scenes a deletion's
     * sweep rewrote. Derived work is what has to be fingerprinted rather than assumed, and this is
     * what puts those scenes into the effect's digests.
     */
    applyOp(op: LiveCharacterOp): readonly LiveDigestScope[];
};

/**
 * The asset library's metadata, one shard per asset type.
 *
 * Four methods where the libraries have four, and one of them is not a promise: an asset shard is
 * read as the workspace starts rather than when a panel opens it, so there is nothing for a session
 * to load on the way in. What it answers instead is which shards it holds - the same one set that
 * becomes what the session carries and what the write boundary leaves writable.
 *
 * ⚠ **Nothing here reaches the bytes**, and that is the whole shape of the document. A session
 * carries what the project says about a file; `AssetsService` refuses to import, replace, duplicate
 * or delete one for as long as a sink is installed, which is why no port method offers it.
 */
export type LiveAssetsPort = {
    /**
     * Where asset edits go instead of into the library, and where the files they name come from.
     * Null takes both back.
     */
    setSink(sink: AssetOpSink | null, blobs: AssetBlobPort | null): void;
    /** Every asset type whose shard this window holds. Empty before the library is up. */
    shardTypes(): readonly string[];
    /** One type's records as they stand, or null when this window does not hold them. */
    records(assetType: string): Readonly<Record<string, LiveAssetRecord>> | null;
    /**
     * Whether one record is there.
     *
     * A boolean where the cast's port answers with the record, because presence is the whole of what
     * the host asks - and a record handed over here would invite a later reader to plan against a
     * copy rather than against the document.
     */
    hasRecord(assetType: string, assetId: string): boolean;
    /**
     * Try the files that were waiting for slices again.
     *
     * Called when a slice arrives. There is no timer behind it and there must not be one: a transfer
     * nobody ever completes would otherwise be a machine asking for it for the rest of the session.
     */
    resumePayloads(): void;
    /** Every section whose folders this window holds. */
    folderCategories(): readonly string[];
    /** One section's folders as they stand, or null when this window does not hold them. */
    folders(category: string): Readonly<Record<string, LiveAssetFolder>> | null;
    /**
     * Apply one operation, without consulting the sink. Synchronous, for the story port's reason.
     *
     * ⚠ **Synchronous even though it is about files**, and that is the whole shape of the design:
     * what it applies is RECORDS, and the files that go with them are queued and put down afterwards.
     * An applier that awaited a disk write would make the host's "one operation at a time, nothing
     * interleaves" promise into an ordering problem.
     *
     * Answers every unit it changed beyond the one the operation names - the asset shards a folder
     * deletion emptied - because derived work is what has to be fingerprinted rather than assumed.
     */
    applyOp(op: LiveAssetOp | LiveAssetFolderOp): readonly LiveDigestScope[];
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
    cast: LiveCastPort;
    localization: LiveLocalizationPort;
    voice: LiveVoicePort;
    assets: LiveAssetsPort;
    variables: LiveVariablesPort;
    version: LiveVersionPort;
    freeze: LiveFreezePort;
    history: LiveHistoryPort;
    /**
     * Milliseconds from a source that only moves forward, and a delayed run that can be cancelled.
     *
     * The guest's re-send timer hangs off both, and they are injected for the reason the guest's own
     * are: "waited too long" has to be something a test can state in a line rather than sit through.
     */
    now(): number;
    schedule(delayMs: number, run: () => void): () => void;
};
