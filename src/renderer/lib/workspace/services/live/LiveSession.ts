import {
    CLAIM_REASSERT_MS,
    LiveClaimStore,
    LiveDivergenceGuard,
    LiveGuest,
    LiveHost,
    type LiveDivergence,
} from "@/lib/live";
import { captureBefore, type LiveBefore } from "@/lib/live/inverse";
import { refuseLiveSessionEntry } from "@/lib/team/liveSessionEntry";
import { assetsDigest } from "@shared/live/assets";
import { assetGroupsDigest } from "@shared/live/assetGroups";
import { LiveBlobInbox, sliceBlob } from "@shared/live/blobs";
import { castDigest, characterAt, characterRecordDigest } from "@shared/live/cast";
import { takesDigest, translationsDigest } from "@shared/live/libraries";
import { assetSetsDigest, audioTracksDigest, dictionaryDigest } from "@shared/live/projectTables";
import { sceneDigest } from "@shared/live/sceneDigest";
import {
    liveSessionWritablePaths,
    type LiveSessionInterface,
    type LiveSessionLocales,
} from "@shared/live/sharedDocuments";
import { uiBlueprintDigest, uiGraphShellDigest } from "@shared/live/uiGraphParts";
import { uiComponentDigest, uiShellDigest, uiSurfaceDigest } from "@shared/live/uiParts";
import {
    assetClaimKey,
    characterClaimKey,
    isLiveMessage,
    opDocumentKind,
    storyRowClaimKey,
    translationClaimKey,
    uiElementClaimKey,
    uiNodeClaimKey,
    type LiveAssetBytePart,
    type LiveAssetFolderOp,
    type LiveAssetOp,
    type LiveAssetRecord,
    type LiveAssetSetOp,
    type LiveAudioTrackOp,
    type LiveBlobChunk,
    type LiveBlobNeeded,
    type LiveCharacterOp,
    type LiveClaimKey,
    type LiveDerived,
    type LiveDictionaryOp,
    type LiveDigestScope,
    type LiveDocument,
    type LiveEffect,
    type LiveLocalizationOp,
    type LiveMessage,
    type LiveOp,
    type LiveRefusal,
    type LiveResync,
    type LiveStoryOp,
    type LiveUIGraphOp,
    type LiveUIOp,
    type LiveVoiceOp,
} from "@shared/live/ops";
import { TEAM_LIVE_PAYLOAD_LIMIT } from "@shared/types/team";
import type { LocalizationUnit } from "@shared/types/localization";
import type { StoryBlockId, StoryId, StoryScene, StorySceneId } from "@shared/types/story";
import type { VoiceUnit } from "@shared/types/voice";
import type { TeamLiveEvent, TeamLiveSession } from "@shared/types/team";
import { blobChunkCount } from "@shared/live/blobs";
import { experimentalState } from "@/lib/experimental";
import { hasExperimentalCondition } from "@shared/types/experimental";
import { categoryOfAssetType, type AssetType } from "../assets/assetTypes";
import type { AssetBlobPort, AssetOpSink } from "../core/AssetsService";
import type { CharacterOpSink } from "../core/CharacterService";
import type { StoryOpSink } from "../story/StoryService";
import type { UIOpSink } from "../ui-editor/UIDocumentService";
import type { UIGraphOpSink } from "../ui-editor/UIGraphService";
import { LiveEffectHistory, type LiveEffectRecord, type LiveStepDirection } from "./liveEffectHistory";
import { decideLiveRole, planLiveJoin } from "./liveEntry";
import type { LiveProjectIdentity, LiveRooms, LiveSessionDeps } from "./liveSessionPorts";
import {
    IDLE_LIVE_SESSION,
    type LiveEntryFailure,
    type LiveSessionEndCause,
    type LiveSessionRole,
    type LiveSessionView,
} from "./liveSessionView";

/**
 * One window's half of a live session: the thing that wires the pure rules to a real room.
 *
 * `LiveHost` and `LiveGuest` know the rules and nothing else - they take a message and answer with
 * one. This is everything the rules are deliberately not: which of the two this window is, how a
 * message reaches a server, when the workspace freezes and thaws, what a checkpoint is recorded
 * for, and what the interface is told while all of it happens.
 *
 * **A host or a guest, never both, and the room says which.** The window that opened the room holds
 * the only copy that counts; every other window sends intents and applies what it is told. There is
 * therefore no path here that applies a local edit optimistically, and none that takes one back.
 *
 * Everything it touches arrives as a port (see `liveSessionPorts`), so the sequences below - open,
 * join, leave, and the undo that sends an inverse - can be exercised without a server, a repository
 * or a second machine.
 *
 * **Re-basing a running session on a newer revision is not here.** It is the escape from the two
 * places that currently end in a refusal - a room whose revision this tree has moved past, and a
 * host's effect log grown uncomfortably long - and it is the host's act: record a checkpoint, push
 * it, and have the room re-synchronise onto it. It belongs beside {@link open}, which is the same
 * sequence performed into a room that does not exist yet.
 */

/** What a running session holds. Null while this window is in none. */
type ActiveSession = {
    room: TeamLiveSession;
    rooms: LiveRooms;
    project: LiveProjectIdentity;
    role: LiveSessionRole;
    storyId: StoryId;
    /**
     * Every story document this session carries, settled on the way in.
     *
     * Read once rather than asked for per operation, because it is what the host compares an
     * incoming document against - and a set that grew mid-session would start accepting operations
     * about a document nobody else has.
     */
    stories: readonly StoryId[];
    /**
     * The languages whose translation and voice libraries this session carries, settled on the way
     * in for {@link stories}' reason - and settled by what this machine could actually READ rather
     * than by what the project declares, because a library not in memory is one no effect can reach.
     */
    locales: LiveSessionLocales;
    /**
     * The asset types whose metadata shards this session carries, settled on the way in with the
     * rest. Read rather than declared, again: a shard the library never loaded is one no effect can
     * be applied to.
     */
    assetTypes: readonly string[];
    /** The sections whose folders this session carries, settled on the way in with the rest. */
    assetCategories: readonly string[];
    /**
     * Whether this session carries the interface and its blueprints, settled on the way in with the
     * rest. Both or neither - see `LiveSessionInterface`.
     */
    ui: LiveSessionInterface;
    /**
     * Slices that have arrived and are waiting for the operation naming them.
     *
     * ⚠ Held per session and cleared with it: a transfer nobody claimed is memory held for a while,
     * never a stray file in the author's project.
     */
    blobsIn: LiveBlobInbox;
    /**
     * Files this window is carrying into the room, by transfer id.
     *
     * Kept after they are sent, because the only repair this channel has is somebody asking again -
     * see `LiveBlobNeeded`. Dropped when the session ends.
     */
    blobsOut: Map<string, Uint8Array>;
    /**
     * Transfers this window has been told to stop carrying.
     *
     * Read by the send loop between turns, which is what lets a cancel reach a file that is halfway
     * out of the door rather than only the ones that have not started.
     */
    blobsDropped: Set<string>;
    /** This window's instance id. What tells its own effects from everybody else's. */
    self: string;
    /** The revision recorded on the way in, or null when there was nothing to record. */
    checkpoint: string | null;
    host: LiveHost | null;
    guest: LiveGuest | null;
    guard: LiveDivergenceGuard | null;
    effects: LiveEffectHistory;
    /**
     * The entries a row arrived with, by row.
     *
     * Filled from every insert that carried them, whoever caused it, because a row this window
     * deletes may have been pasted by somebody else - and the insert that undoes that delete has to
     * bring the same translations and takes back with it. See {@link LiveEffectRecord.derived}.
     */
    derivedByBlock: Map<StoryBlockId, LiveDerived>;
    /**
     * This window's own effects, by the operation object inside them.
     *
     * The guest applies effects in the host's order, which is not the order they arrive in, so the
     * only thing that carries the identity of an effect from the message that brought it to the
     * moment it is applied is the operation object itself. Weak, because an effect that is never
     * applied - one behind a gap that a catch-up filled another way - must not be kept for ever.
     */
    mine: WeakMap<LiveOp, LiveEffect>;
    /** What `captureBefore` read for the operation being applied right now. See {@link applyOp}. */
    pendingBefore: LiveBefore | null;
    /** The host's application order. */
    seq: number;
    /**
     * The revision of the claim set this window last put on the wire. Host only.
     *
     * Compared against the store's own revision to decide whether there is anything to say, which
     * is the whole of "broadcast the set whenever it changes" and needs no subscription: it starts
     * at the store's starting revision, so a session in which nobody ever writes a row sends no
     * claims message at all.
     */
    claimsSeq: number;
    /**
     * Cancels the sweep that is due next, or null for a session with none. Host only.
     *
     * A lapse is the one movement of the claim set that nobody asked for, so it is the one that
     * needs a tick of its own to be noticed. See {@link LiveSession.scheduleClaimSweep}.
     */
    claimSweep: (() => void) | null;
    /** Set once the copies stop agreeing; the session ends on the next turn of the loop. */
    divergence: LiveDivergence | null;
    /** How many undo or redo steps this window has sent, for the keys their answers arrive under. */
    steps: number;
    stopListening: () => void;
    stopWatching: () => void;
};

/**
 * How many slices go out before the send loop lets the room have a turn.
 *
 * A thirty-megabyte file is a couple of thousand messages; sent in one loop they would sit in front
 * of every operation anybody else states for as long as it took. Small enough that a transfer still
 * finishes in seconds, large enough that the yield itself is not the cost.
 */
const BLOBS_PER_TURN = 24;

/**
 * How many missing slices a repair request may name before it asks for the file instead.
 *
 * A list of indices is JSON, and one message is 16 KiB: a request naming every slice of a large file
 * would not fit in the message that carries it. An empty list already means the whole file, which is
 * the honest answer when that many are gone.
 */
const MAX_NAMED_SLICES = 512;

/**
 * How long the send loop waits between turns while `slow-live-transfer` is on.
 *
 * A local room moves a twenty-five-megabyte file in about a second, which is the right answer for an
 * author and the wrong one for anybody trying to look at what a transfer looks like while it is
 * happening. Long enough that the state between starting and finishing can be read on both screens,
 * and reachable only from a development launch that asks for it by name.
 */
const SLOW_BLOB_TURN_MS = 260;

/** The section an asset type is filed under, as the browser files it. */
function assetCategoryOf(assetType: string): string {
    return categoryOfAssetType(assetType as AssetType);
}

/** How many slices one part of a transfer takes. What a repair request has to name. */
function chunkCountOf(part: LiveAssetBytePart): number {
    return blobChunkCount(part.size);
}

export class LiveSession {
    private view: LiveSessionView = IDLE_LIVE_SESSION;
    private readonly listeners = new Set<(view: LiveSessionView) => void>();
    private active: ActiveSession | null = null;

    public constructor(private readonly deps: LiveSessionDeps) {}

    /* ------------------------------------------------------------------- reading */

    public getView(): LiveSessionView {
        return this.view;
    }

    public onChanged(handler: (view: LiveSessionView) => void): () => void {
        this.listeners.add(handler);
        return () => {
            this.listeners.delete(handler);
        };
    }

    /**
     * Whether a session owns this story document right now.
     *
     * The one question the story editor asks. Two things hang off it and both are about undo: a
     * local gesture must record no scene snapshot while a session is running, and Ctrl+Z must send
     * an inverse instead of restoring one.
     */
    public ownsStory(storyId: StoryId): boolean {
        return this.active !== null && this.active.storyId === storyId;
    }

    /* ------------------------------------------------------------------ entering */

    /**
     * Open a room on this project, with this window as its host.
     *
     * **The checkpoint comes first and the room opens on what it recorded.** A room opened on a
     * revision the author's tree has moved past is a room whose members do not share a starting
     * point: everyone else fetches that revision, and the difference between it and what the host
     * is actually holding never travels anywhere. The push is the other half of the same sentence -
     * a revision only this machine has is not a starting point anybody can reach.
     */
    public async open(input: { storyId: StoryId; title?: string }): Promise<LiveEntryFailure | null> {
        const blocked = this.blocked();
        if (blocked) {
            return this.failEntry(blocked);
        }
        this.patch({ phase: "entering", entryFailure: null, ended: null });
        try {
            const ready = await this.ready();
            if ("kind" in ready) {
                return this.failEntry(ready);
            }
            const recorded = await this.deps.version.checkpoint();
            // Null means the tree had nothing to record, and the head is then already the revision
            // this session's document stands at. A checkpoint of an unchanged tree is a lie about
            // the author's history, so the absence of one is the ordinary case rather than a fault.
            const revision = recorded ?? (await this.deps.version.head());
            if (!revision) {
                return this.failEntry({ kind: "no-revision" });
            }
            await this.deps.version.push();
            const opened = await ready.rooms.open({
                project: ready.project.repositoryId,
                revision,
                // What the room is about, said once here and read by everybody who joins. The
                // alternative - letting each joiner work it out - can only ever produce a document
                // that machine already has.
                story: input.storyId,
                ...(input.title === undefined ? {} : { title: input.title }),
            });
            if (!opened.ok) {
                return this.failEntry({ kind: "refused", problem: opened.problem });
            }
            await this.enter({
                room: opened.value,
                rooms: ready.rooms,
                project: ready.project,
                self: ready.instance,
                storyId: input.storyId,
                checkpoint: recorded,
            });
            return null;
        } catch (error) {
            return this.failEntry({ kind: "failed", detail: describe(error) });
        }
    }

    /**
     * Join a room somebody else opened.
     *
     * Two shapes, and `planLiveJoin` decides which. A machine that has the project records a
     * checkpoint for anything uncommitted - so that what the author did before the session is
     * somewhere they can go back to, rather than something the session's state lands on top of -
     * and then brings its tree to the revision the room opened on. A machine that does not have the
     * project has nothing to protect and needs a clone, which is a flow that belongs to a window
     * with no project open; that is reported rather than performed.
     *
     * Either way the last thing before following along is asking the host for everything since the
     * room opened, because an operation applied out of the host's order produces a document the
     * host never held.
     */
    public async join(input: { session: TeamLiveSession | string }): Promise<LiveEntryFailure | null> {
        const blocked = this.blocked();
        if (blocked) {
            return this.failEntry(blocked);
        }
        this.patch({ phase: "entering", entryFailure: null, ended: null });
        try {
            const ready = await this.ready();
            if ("kind" in ready) {
                return this.failEntry(ready);
            }
            const room = await this.findRoom(ready.rooms, ready.project.repositoryId, input.session);
            if (room === null) {
                return this.failEntry({
                    kind: "room-gone",
                    sessionId: typeof input.session === "string" ? input.session : input.session.id,
                });
            }
            // The room's own answer, never this window's. A joiner that worked out the document
            // for itself could only ever land on one it already holds - the wrong one whenever the
            // two copies differ about which story comes first, and none at all for somebody whose
            // way of getting the project is this very act.
            const storyId = room.story as StoryId | undefined;
            if (storyId === undefined) {
                return this.failEntry({ kind: "room-story-unknown" });
            }
            const plan = planLiveJoin({
                sessionProject: room.project,
                openProject: ready.project.repositoryId,
                uncommittedChanges: await this.deps.version.hasUncommittedChanges(),
                ...(room.revision === undefined ? {} : { revision: room.revision }),
            });
            if (plan.kind === "clone") {
                return this.failEntry({
                    kind: "clone-required",
                    project: plan.project,
                    ...(plan.revision === undefined ? {} : { revision: plan.revision }),
                });
            }
            const checkpoint = plan.checkpoint ? await this.deps.version.checkpoint() : null;
            const synced = await this.deps.version.sync();
            if (synced.conflicts.length > 0) {
                // A merge is open now, and a merge is one of the freezes that refuses a session
                // anyway. Settling it comes first; the room will still be there or it will not.
                return this.failEntry({ kind: "merge-conflicts", paths: synced.conflicts });
            }
            if (room.revision !== undefined) {
                const head = await this.deps.version.head();
                if (head !== room.revision) {
                    // Somebody pushed past the revision the room opened on, so this tree cannot be
                    // brought to it by syncing. Joining anyway would put two machines in one room
                    // holding different documents - the failure the digest guard catches after the
                    // fact, walked into deliberately. Re-basing a running session on a newer
                    // revision is what fixes this, and nothing here does that yet.
                    return this.failEntry({ kind: "revision-mismatch", expected: room.revision, actual: head });
                }
            }
            if (this.deps.story.document(storyId) === null) {
                // The sync has landed, so this is the tree the room opened on and the document
                // still is not in it. Entering anyway would give every read of it null and say
                // nothing about why.
                return this.failEntry({ kind: "story-not-here", storyId });
            }
            const joined = await ready.rooms.join(room.id);
            if (!joined.ok) {
                return this.failEntry({ kind: "refused", problem: joined.problem });
            }
            await this.enter({
                room: joined.value,
                rooms: ready.rooms,
                project: ready.project,
                self: ready.instance,
                storyId,
                checkpoint,
            });
            return null;
        } catch (error) {
            return this.failEntry({ kind: "failed", detail: describe(error) });
        }
    }

    /** Leave. The freeze lifts and what is on disk is this author's own, committable as usual. */
    public async leave(): Promise<void> {
        await this.end("left");
    }

    /**
     * The window is going away.
     *
     * The freeze and the sink are both module-level or service-level and outlive this object, so a
     * teardown that left either in place would be a project that refuses to save, or an editor
     * handing gestures to a room nobody is in.
     */
    public dispose(): void {
        void this.end("left");
    }

    /* -------------------------------------------------------------------- claims */

    /**
     * Say that this window is writing a row, or that it has stopped.
     *
     * **One method for both roles and for both halves of the statement**, because a give-back that
     * could be wired up without its take - or taken on one role and forgotten on the other - is a
     * row nobody can edit for the rest of the session. A guest sends the message and holds nothing;
     * a host records it in its own store, which is the only place a claim exists, and broadcasts
     * the set that resulted.
     *
     * Silent outside a session, and for a scene of any other story: the rows of a document no room
     * is about are this author's own to write.
     */
    public claimRow(storyId: StoryId, blockId: StoryBlockId, holding: boolean): void {
        if (this.active && this.active.storyId !== storyId) {
            return;
        }
        this.claim(storyRowClaimKey(blockId), holding);
    }

    /**
     * This window is editing one character record, or has stopped.
     *
     * The cast's door, beside the story's. Held while the record is open in the properties panel -
     * the box being open, not the keyboard - for the reason the row's claim is: an author who has
     * stopped to think about a sentence still has a description half typed, and a claim that lapsed
     * on their pause is a claim that lets somebody else take it.
     *
     * There is no story id to check, because there is one cast per project: a session either carries
     * it or the window is not in a session.
     */
    public claimCharacter(characterId: string, holding: boolean): void {
        this.claim(characterClaimKey(characterId), holding);
    }

    /**
     * This window is writing one translation, or has stopped.
     *
     * The translations' door, beside the row's and the record's, and held for the same span: while
     * the field is open in front of somebody, not while their fingers are moving. The translation
     * field IS the working copy - a contentEditable the browser edits, which reaches the document on
     * Enter or blur - so a claim that lapsed on a translator's pause would be a claim that let
     * somebody else write over a line they were halfway through.
     *
     * The language is part of the key: the same line has an entry in every language, and two
     * translators working in two of them are not in each other's way.
     *
     * ⚠ There is deliberately no counterpart for a voice take. See `CLAIMED_OPS`.
     */
    public claimTranslation(locale: string, unitId: string, holding: boolean): void {
        this.claim(translationClaimKey(locale, unitId), holding);
    }

    /**
     * This window is editing one asset record, or has stopped.
     *
     * The library's door beside the row's, the record's and the translation's, and held for the same
     * span: while the inspector has the asset open, not while somebody's fingers are moving. Its name
     * and description are `TextField`s, which keep a draft in their own state until the field is
     * blurred and re-sync from their props the moment somebody else's edit arrives - so a claim that
     * lapsed on a pause would let that edit take the sentence with it.
     *
     * No asset type, because an id is unique across the whole library. ⚠ There is deliberately no
     * counterpart for filing an asset in a folder - see `CLAIMED_OPS`.
     */
    public claimAsset(assetId: string, holding: boolean): void {
        this.claim(assetClaimKey(assetId), holding);
    }

    /**
     * This window is writing one interface element, or has stopped.
     *
     * Held while the properties panel has that element selected, which is the only place the
     * interface keeps a draft: its text fields commit on a throttle or on blur, so somebody else's
     * edit to the same element arriving mid-sentence takes the sentence with it. The component id is
     * in the key because a component definition owns its own element map.
     */
    public claimUIElement(componentId: string | null, elementId: string, holding: boolean): void {
        this.claim(uiElementClaimKey(componentId, elementId), holding);
    }

    /**
     * This window is writing one blueprint node, or has stopped.
     *
     * The element's counterpart on the canvas: a node's parameter editors are the draft layer, and
     * the blueprint and graph are in the key because node ids are not unique across the document.
     */
    public claimUINode(blueprintId: string, graphId: string, nodeId: string, holding: boolean): void {
        this.claim(uiNodeClaimKey(blueprintId, graphId, nodeId), holding);
    }

    /**
     * Take or give back one claim, whichever kind it is.
     *
     * The one path for both, so the host's record and the broadcast that follows it cannot come to
     * differ between them. Silent outside a session: what this window is editing on its own is its
     * own business.
     */
    private claim(key: LiveClaimKey, holding: boolean): void {
        const session = this.active;
        if (!session) {
            return;
        }
        if (session.host) {
            session.host.claimLocal(key, holding);
            this.broadcastClaims(session);
            this.publish(session, {});
            return;
        }
        // Nothing is written here and nothing on screen moves. A guest holds it when a set arrives
        // naming it, and never because it asked.
        session.guest?.claim(key, holding);
    }

    /**
     * Put the whole claim set on the wire, if it is not the set already there.
     *
     * **The whole set, never the change.** A machine that missed one change would otherwise show a
     * stale name over somebody's cursor for the rest of the session, with nothing coming along to
     * correct it; a set is small, and the newest one is always the complete answer.
     *
     * Driven by the store's revision, so every way the set can move goes out by one path: a row
     * taken, a row given back, a row that lapsed on the clock, a row forgotten because it was
     * deleted, and everything a window that left the room was holding.
     */
    private broadcastClaims(session: ActiveSession): void {
        if (session.host && session.host.claims.revision !== session.claimsSeq) {
            this.sendClaims(session);
        }
    }

    /**
     * Look for claims that have fallen due, and say so if any have. Host only.
     *
     * ⚠ **A lapse is the one change to the set that nobody asked for**, and therefore the one with
     * no answer to ride out on. Every other movement happens while the host is replying to
     * something - a row taken, given back, deleted, or a window leaving - and the new set goes with
     * the reply. Without this, a name stayed on screen until the next thing happened in the room,
     * which could be minutes.
     *
     * That was once written off as costing nothing, on the grounds that the host expires a claim
     * while answering the operation that asks about it - so the row really is free to be written
     * the moment somebody tries. The reasoning is sound and the conclusion was wrong: a name over a
     * row is not decoration, it is what stops the person reading it from touching that row, and
     * showing one that has lapsed invites exactly the edit the claim existed to refuse. On a real
     * machine somebody deleted a line they had been told alice was writing, and alice lost the
     * draft in her open box.
     *
     * Re-scheduled after each run rather than repeating, so the interval is one thing to cancel and
     * a session that ended between two of them cannot leave one pending.
     */
    private scheduleClaimSweep(session: ActiveSession): void {
        session.claimSweep = this.deps.schedule(CLAIM_REASSERT_MS, () => {
            session.claimSweep = null;
            if (this.active !== session || !session.host) {
                return;
            }
            if (session.host.claims.sweep()) {
                this.broadcastClaims(session);
                // The host's own screen reads the set from the store, so it needs telling too.
                this.publish(session, {});
            }
            this.scheduleClaimSweep(session);
        });
    }

    /** The set, said whether or not it has moved. For a machine that has never been told one. */
    private sendClaims(session: ActiveSession): void {
        const host = session.host;
        if (!host || this.active !== session) {
            return;
        }
        const claims = host.claims.snapshot();
        session.claimsSeq = claims.seq;
        session.rooms.say(session.room.id, claims);
    }

    /* ---------------------------------------------------------------------- undo */

    /**
     * Take back the last thing this window did, by sending its inverse.
     *
     * **Not the room's last operation - this window's.** In a shared scene those stopped being the
     * same thing, and somebody else's rows landing on top of mine do not stop me taking mine back
     * so long as the inverse still applies. Where it does not, the reason is put on the view and
     * nothing is sent: never a snapshot as a fallback, and never a silent nothing.
     */
    public undo(): boolean {
        return this.step("undo");
    }

    /** Put back what {@link undo} took. The inverse of the inverse, under exactly the same rules. */
    public redo(): boolean {
        return this.step("redo");
    }

    private step(direction: LiveStepDirection): boolean {
        const session = this.active;
        if (!session) {
            return false;
        }
        const document = this.deps.story.document(session.storyId);
        const cast = this.deps.cast.view();
        if (!document) {
            // The story is not held here any more, so nothing can be read to invert against. The cast
            // always is - it is one document per project and the workspace has it loaded - so there is
            // no matching guard for it.
            this.patch({ undoRefusal: "no-record" });
            return false;
        }
        const plan = session.effects.plan(direction, {
            self: session.self,
            document,
            cast,
            assets: assetType => this.deps.assets.records(assetType),
            assetFolders: category => this.deps.assets.folders(category),
            audioTracks: () => this.deps.audioTracks.tracks(),
            assetSets: () => this.deps.assetSets.sets(),
        });
        if ("impossible" in plan) {
            this.patch({ undoRefusal: plan.impossible });
            return false;
        }
        if (session.host) {
            const key = `step:${(session.steps += 1)}`;
            session.effects.expect(key, plan);
            const answer = this.hostApply(session, plan.op, plan.derived, key);
            if (answer.kind === "refusal") {
                session.effects.abandon(key);
                return false;
            }
            this.publish(session, { undoRefusal: null });
            return true;
        }
        const guest = session.guest;
        if (!guest) {
            return false;
        }
        const intent = guest.intend(plan.op, this.documentOf(session, plan.op), plan.derived);
        // Settled when the effect answering it comes back, never on sending: the host may refuse,
        // and a cursor that had already moved would leave the author one press further back than
        // the document is.
        session.effects.expect(intent.clientId, plan);
        this.publish(session, { undoRefusal: null });
        return true;
    }

    /* ------------------------------------------------------------------ the room */

    private async enter(input: {
        room: TeamLiveSession;
        rooms: LiveRooms;
        project: LiveProjectIdentity;
        self: string;
        storyId: StoryId;
        checkpoint: string | null;
    }): Promise<void> {
        const role = decideLiveRole(input.room, input.self);
        // Before a single operation can arrive. Every entry in those stacks is a whole-scene
        // snapshot of a document only this author ever had, and one applied after the session would
        // put the scene back as it was before anybody else joined.
        this.deps.history.forgetStoryScenes(input.storyId);
        // Flushes what is owed first, then refuses everything but this session's story document.
        // Every story into memory before anything is frozen or applied. A machine that never opened
        // one could not apply a sweep that reaches it, and appliers are synchronous - there is no
        // later moment at which a document could be fetched. See `LiveStoryPort.loadAll`.
        const stories = await this.deps.story.loadAll();
        // And every language's two libraries, for exactly the same reason: a translation effect
        // arriving for a language this window never opened could not be applied, and there is no
        // moment after this at which one could be fetched.
        const locales: LiveSessionLocales = {
            translations: await this.deps.localization.loadAll(),
            voice: await this.deps.voice.loadAll(),
        };
        // Nothing to read: an asset shard is loaded as the workspace starts rather than when a panel
        // opens it, so this only asks which ones are there.
        const assetTypes = this.deps.assets.shardTypes();
        const assetCategories = this.deps.assets.folderCategories();
        // Nothing to read here either: both interface documents are loaded as the workspace starts.
        // What this asks is whether they are there, which is what the session carries and what the
        // boundary leaves writable - one set, from one call.
        const ui: LiveSessionInterface = { carried: this.deps.ui.held() };
        await this.deps.freeze.arm({
            session: input.room.id,
            // From the one table that also decides what the host will carry, never assembled here.
            // A path allowed by the boundary that the vocabulary cannot carry is an edit that lands
            // on this machine and nowhere else, with no digest over it - see `sharedDocuments`.
            writable: liveSessionWritablePaths(stories, locales, assetTypes, assetCategories, ui),
        });

        const session: ActiveSession = {
            room: input.room,
            rooms: input.rooms,
            project: input.project,
            role,
            storyId: input.storyId,
            stories,
            locales,
            assetTypes,
            assetCategories,
            ui,
            blobsIn: new LiveBlobInbox(),
            blobsOut: new Map(),
            blobsDropped: new Set(),
            self: input.self,
            checkpoint: input.checkpoint,
            host: null,
            guest: null,
            guard: null,
            effects: new LiveEffectHistory(),
            derivedByBlock: new Map(),
            mine: new WeakMap(),
            pendingBefore: null,
            seq: 0,
            claimsSeq: 0,
            claimSweep: null,
            divergence: null,
            steps: 0,
            stopListening: () => undefined,
            stopWatching: () => undefined,
        };
        this.active = session;

        if (role === "host") {
            session.host = new LiveHost({
                // The session's own clock rather than the store's default, so a room runs on one
                // reading of the time. Two of them would be two answers to "has this lapsed", and
                // the one that decides a refusal must be the one a test can move.
                claims: new LiveClaimStore({ now: () => this.deps.now() }),
                self: input.self,
                stories,
                locales,
                assetTypes,
                assetCategories,
                ui,
                readScene: (storyId, sceneId) => this.deps.story.document(storyId)?.scenes[sceneId] ?? null,
                readCharacter: characterId => this.deps.cast.view().characters[characterId] ?? null,
                hasAsset: (assetType, assetId) => this.deps.assets.hasRecord(assetType, assetId),
                readAssetFolders: category => this.deps.assets.folders(category),
                hasUIElement: ref => this.deps.ui.hasElement(ref),
                hasBlueprint: blueprintId => this.deps.ui.hasBlueprint(blueprintId),
                hasAudioTrack: trackId =>
                    this.deps.audioTracks.tracks()?.some(track => track.id === trackId) ?? false,
                hasAssetSet: setId => this.deps.assetSets.sets()?.some(set => set.id === setId) ?? false,
                digestOf: scope => this.digestOf(scope),
                // `derived` is passed through, not applied afterwards: the entries a paste carries
                // are written by the same call the effect's digests are taken from, so a machine
                // that skipped half of them is caught by this effect rather than never.
                applyOp: (op, document, derived) => this.applyOp(session, op, document, derived),
                nextSeq: () => (session.seq += 1),
                // The room's own roster, which is the only thing that knows which account a window
                // signed in as. Read through `session.room` rather than captured, so a claim taken
                // by somebody who joined after this session started still names them.
                accountOf: instance =>
                    session.room.members.find(member => member.instance === instance)?.account ?? null,
                // `isMember` is deliberately left permissive. The server delivers a room's messages
                // to its members and to nobody else, so anything that arrives here is from somebody
                // who is in the room; a second roster kept in this window could only ever be older
                // than the server's, and the only thing it could produce is a refusal of an intent
                // that was perfectly legitimate.
            });
            this.scheduleClaimSweep(session);
        } else {
            session.guard = new LiveDivergenceGuard();
            session.guest = new LiveGuest({
                self: input.self,
                applyOp: (op, document, derived) => this.applyOp(session, op, document, derived),
                send: message => session.rooms.say(session.room.id, message),
                now: () => this.deps.now(),
                schedule: (delayMs, run) => this.deps.schedule(delayMs, run),
                digestOf: scope => this.digestOf(scope),
                onDigest: (effect, compute) => {
                    const ruling = session.guard?.check(effect, compute);
                    if (ruling && ruling.verdict === "diverged") {
                        // Recorded rather than acted on: this runs inside the guest's own apply
                        // loop, and leaving from underneath it would tear the session down while a
                        // batch of effects was still being drained.
                        session.divergence = ruling.divergence;
                    }
                },
                onRefusal: (refusal, intent) => {
                    if (intent) {
                        session.effects.abandon(intent.clientId);
                    }
                    this.noteRefusal(session, refusal, intent?.op.op ?? null);
                },
            });
        }

        session.stopListening = input.rooms.listen(input.room.id, (payload, from) =>
            this.onMessage(session, payload, from));
        session.stopWatching = input.rooms.watch(input.project.repositoryId, event =>
            this.onRoomEvent(session, event));
        this.deps.story.setSink(this.sinkFor(session));
        this.deps.cast.setSink(this.castSinkFor(session));
        this.deps.localization.setSink(this.librarySinkFor(session));
        this.deps.voice.setSink(this.librarySinkFor(session));
        this.deps.assets.setSink(this.assetSinkFor(session), this.blobPortFor(session));
        this.deps.ui.setSink(this.interfaceSinkFor(session));
        // The three small project tables, through the same sink the libraries use: none of them has
        // a document id this window has to be holding for an operation to be about it.
        this.deps.dictionary.setSink(this.librarySinkFor(session));
        this.deps.audioTracks.setSink(this.librarySinkFor(session));
        this.deps.assetSets.setSink(this.librarySinkFor(session));

        if (role === "guest") {
            // Everything the host has done since the room opened, before this window follows along.
            // `after: 0` because a guest that has just joined has applied nothing.
            const resync: LiveResync = { kind: "resync", by: input.self, after: 0 };
            input.rooms.say(input.room.id, resync);
        }
        this.publish(session, {
            phase: role === "host" ? "active" : "catching-up",
            entryFailure: null,
            ended: null,
            undoRefusal: null,
            lastRefusal: null,
        });
    }

    private async end(cause: LiveSessionEndCause): Promise<void> {
        const session = this.active;
        if (!session) {
            return;
        }
        this.active = null;
        this.patch({ phase: "leaving" });
        // First, so nothing the author does next can become an intent for a room this window is on
        // its way out of.
        this.deps.story.setSink(null);
        this.deps.cast.setSink(null);
        this.deps.localization.setSink(null);
        this.deps.voice.setSink(null);
        this.deps.assets.setSink(null, null);
        this.deps.ui.setSink(null);
        this.deps.dictionary.setSink(null);
        this.deps.audioTracks.setSink(null);
        this.deps.assetSets.setSink(null);
        session.blobsIn.clear();
        session.blobsOut.clear();
        session.blobsDropped.clear();
        session.stopListening();
        session.stopWatching();
        session.claimSweep?.();
        session.claimSweep = null;
        session.guest?.close();
        const said = session.role === "host"
            // A host leaving ends the room: it held the only copy that counts, and there is no
            // authority left for an intent to reach. Closing says so rather than leaving the server
            // to work it out from the last member walking away.
            ? session.rooms.close(session.room.id)
            : session.rooms.leave(session.room.id);
        // Lifted here rather than after the server answers. A latch that outlived its session is a
        // project that refuses to save with nothing on screen to explain why, and whether the
        // server heard about it changes nothing about this window's own files.
        this.deps.freeze.lift(session.room.id);
        this.set({
            ...IDLE_LIVE_SESSION,
            ended: {
                cause,
                sessionId: session.room.id,
                // A host leaving takes the room with it - that is what `close` above says to the
                // server - and `host-left` is the same event seen by a guest. Everything else is
                // one window stepping out of a room that is still there.
                closed: session.role === "host" || cause === "host-left",
                ...(session.divergence === null ? {} : { divergence: session.divergence }),
            },
        });
        await said.catch(() => undefined);
    }

    private onRoomEvent(session: ActiveSession, event: TeamLiveEvent): void {
        if (this.active !== session) {
            return;
        }
        if (event.kind === "live-closed") {
            if (event.session !== session.room.id) {
                return;
            }
            // For a guest this is the host's window having gone. For a host it is its own room
            // closing, which is the same ending seen from the other side.
            void this.end(session.role === "host" ? "left" : "host-left");
            return;
        }
        if (event.session.id !== session.room.id) {
            return;
        }
        const before = session.room.members;
        session.room = event.session;
        if (session.host) {
            // The one ending a give-back cannot cover: the machine that would have sent one has
            // gone. Whatever it was writing, it is not writing it now, and leaving the rows held
            // until they lapse would hold them against a deadline measured in a pause in typing.
            const present = new Set(event.session.members.map(member => member.instance));
            for (const member of before) {
                if (!present.has(member.instance)) {
                    session.host.forgetInstance(member.instance);
                }
            }
            this.broadcastClaims(session);
        }
        this.publish(session, {});
    }

    /* -------------------------------------------------------------- the messages */

    private onMessage(session: ActiveSession, payload: unknown, from: string): void {
        if (this.active !== session || !isLiveMessage(payload)) {
            // Not a message this build understands. Dropped where it lands rather than thrown on:
            // the payload comes from another Studio, which may be a different version.
            return;
        }
        if (payload.kind === "blob" || payload.kind === "blob-needed") {
            // ⚠ Before the host/guest split, and never through either of them. Bytes in flight are
            // not operations: they change no document, take no sequence number and are applied by
            // nobody, which is what keeps a large import from stopping everybody else's typing.
            this.onBlobMessage(session, payload);
            return;
        }
        if (session.host) {
            const answer = session.host.receive(payload, from);
            if (answer) {
                // Nothing is adopted here. The entries a paste carries are written inside
                // {@link applyOp}, along with everything else that effect changed, because the
                // digests the host stamps on the message are taken from what that call reported -
                // and an adoption done afterwards would be work no fingerprint covers.
                session.rooms.say(session.room.id, answer);
            }
            // After the answer, because the two are about different things and the order they are
            // read in matters: a delete's effect has to reach a machine before the set that no
            // longer names the row it deleted.
            if (payload.kind === "resync") {
                // A window that has just joined, or one that saw a gap. The catch-up above says
                // what the host DID; this says what is being written right this moment, which no
                // effect describes. Without it a machine joining mid-paragraph sees an unmarked
                // scene and learns the truth by being refused - the injury a claim exists to
                // prevent, arriving one gesture too late.
                this.sendClaims(session);
            } else {
                this.broadcastClaims(session);
            }
            this.publish(session, {});
            return;
        }
        const guest = session.guest;
        if (!guest) {
            return;
        }
        this.markMine(session, payload);
        guest.receive(payload);
        if (session.divergence) {
            // The copies differ, and neither machine can tell which is wrong. Leaving is the cheap,
            // loud, recoverable answer; carrying on is the expensive silent one.
            void this.end("diverged");
            return;
        }
        this.publish(session, {
            // A catch-up addressed to this window is the end of joining: everything the host did
            // before it arrived has been applied, in the host's order.
            ...(payload.kind === "catch-up" && payload.to === session.self ? { phase: "active" as const } : {}),
        });
    }

    /**
     * Remember which arriving effects are this window's own.
     *
     * Done here rather than where they are applied because the guest applies in the host's order
     * and not in the order things arrive: an effect can wait behind a gap for a catch-up to fill.
     * The operation object inside the message is what survives that wait, so it is the key.
     */
    private markMine(session: ActiveSession, message: LiveMessage): void {
        if (message.kind === "effect") {
            if (message.by === session.self) {
                session.mine.set(message.op, message);
            }
            return;
        }
        if (message.kind === "catch-up" && message.to === session.self) {
            for (const effect of message.effects) {
                if (effect.by === session.self) {
                    session.mine.set(effect.op, effect);
                }
            }
        }
    }

    /* ------------------------------------------------------------------ applying */

    private readScene(session: ActiveSession, sceneId: StorySceneId): StoryScene | null {
        return this.deps.story.document(session.storyId)?.scenes[sceneId] ?? null;
    }

    /**
     * Apply one operation to this window's document.
     *
     * The one place a document changes inside a session, for both roles, which is what makes
     * "immediately before applying" a single moment rather than a rule every call site has to
     * remember: what an operation is about to overwrite is knowable here and nowhere later.
     */
    private applyOp(
        session: ActiveSession,
        op: LiveOp,
        document: LiveDocument,
        derived?: LiveDerived,
    ): readonly LiveDigestScope[] {
        // Read from both documents, whichever this operation is about. One call rather than a switch,
        // because "what was here immediately before" is one question and answering it in two places
        // would be two moments, only one of which is the right one.
        session.pendingBefore = captureBefore(op, {
            story: this.deps.story.document(document.doc === "story" ? document.storyId : session.storyId),
            cast: this.deps.cast.view(),
            translations: locale => this.deps.localization.units(locale),
            takes: locale => this.deps.voice.units(locale),
            assets: assetType => this.deps.assets.records(assetType),
            assetFolders: category => this.deps.assets.folders(category),
            assetsByType: category => this.assetsOfCategory(category),
            ui: this.deps.ui.document(),
            uiGraphs: this.deps.ui.graphs(),
            dictionary: () => this.deps.dictionary.document(),
            audioTracks: () => this.deps.audioTracks.tracks(),
            assetSets: () => this.deps.assetSets.sets(),
            // The rows a deletion is about to un-speak, read while they still say whose they are.
            // Only this window needs them - they are what ITS undo would have to put back - so they
            // are read here rather than carried on the effect.
            ...(op.op === "delete-character" ? { spoke: this.deps.story.rowsSpokenBy(op.characterId) } : {}),
        });
        const touched: LiveDigestScope[] = [];
        switch (document.doc) {
            case "characters":
                touched.push(...this.deps.cast.applyOp(op as LiveCharacterOp));
                break;
            case "localization":
                this.deps.localization.applyOp(op as LiveLocalizationOp);
                break;
            case "voice":
                this.deps.voice.applyOp(op as LiveVoiceOp);
                break;
            case "assets":
            case "asset-groups":
                touched.push(...this.deps.assets.applyOp(op as LiveAssetOp | LiveAssetFolderOp));
                break;
            case "story":
                this.deps.story.applyOp(document.storyId, op as LiveStoryOp);
                break;
            case "ui":
            case "ui-graphs":
                touched.push(...this.deps.ui.applyOp(op as LiveUIOp | LiveUIGraphOp));
                break;
            case "dictionary":
                this.deps.dictionary.applyOp(op as LiveDictionaryOp);
                break;
            case "audio-tracks":
                this.deps.audioTracks.applyOp(op as LiveAudioTrackOp);
                break;
            case "asset-sets":
                this.deps.assetSets.applyOp(op as LiveAssetSetOp);
                break;
        }
        this.rememberDerived(session, op, derived);
        if (derived) {
            // ⚠ Reported, not merely done. These entries are DERIVED - every machine writes them
            // for itself out of what the effect carried - so they are exactly the work that has to
            // be fingerprinted rather than assumed, and this is what puts the libraries they landed
            // in into the effect's digests. Adopting without reporting is how a machine that wrote
            // half of them went unnoticed once already.
            touched.push(...this.deps.story.adoptDerived(derived));
        }
        const mine = session.mine.get(op);
        if (mine) {
            // A guest's own effect, coming back applied. The host's own are recorded where they are
            // produced instead - see {@link hostApply} - because there the effect does not exist
            // until after this has run.
            session.mine.delete(op);
            this.record(session, mine, session.pendingBefore);
            session.pendingBefore = null;
        }
        return touched;
    }

    /**
     * The address of the document an operation is about, for the message that carries it.
     *
     * Derived from the verb rather than passed in, so the two can never disagree: the host refuses a
     * message whose operation could not be about the document it names, and the only way to be sure
     * this window never sends one is to have one place build it.
     */
    private documentOf(session: ActiveSession, op: LiveOp): LiveDocument {
        switch (opDocumentKind(op)) {
            case "characters":
                return { doc: "characters" };
            // A library operation names its own language, so the address is read off the operation
            // rather than composed from something this window happens to have open - which is the
            // only way the two can be guaranteed to agree. `opAddresses` is the host checking it.
            case "localization":
                return { doc: "localization", locale: (op as LiveLocalizationOp).locale };
            case "voice":
                return { doc: "voice", locale: (op as LiveVoiceOp).locale };
            // Reads its own type off the operation, exactly as a library operation reads its locale,
            // and for the same reason: the two spellings of "which document" can then never disagree.
            case "assets":
                return { doc: "assets", assetType: (op as LiveAssetOp).assetType };
            case "asset-groups":
                return { doc: "asset-groups", category: (op as LiveAssetFolderOp).category };
            case "story":
                return { doc: "story", storyId: session.storyId };
            // One of each per project, so the address is the whole of it - the cast's shape.
            case "ui":
                return { doc: "ui" };
            case "ui-graphs":
                return { doc: "ui-graphs" };
            // One of each per project, so the kind is the whole address and there is nothing to
            // read off the operation.
            case "dictionary":
                return { doc: "dictionary" };
            case "audio-tracks":
                return { doc: "audio-tracks" };
            case "asset-sets":
                return { doc: "asset-sets" };
        }
    }

    /**
     * The fingerprint of one unit as this window now holds it, or null when it cannot be read.
     *
     * The one place a digest is computed, for both roles: the host stamps the effect it broadcasts
     * and a guest computes the same thing over its own copy, and two implementations would report
     * disagreements that were only two spellings of one document.
     *
     * Null is "nothing was compared", never "they agree" - which is why a missing scene answers null
     * and a missing character record does not. Absence is a value the cast's digest can state, so a
     * machine that failed to apply a creation is caught rather than excused; a scene this window does
     * not hold is a window that has nothing to say.
     */
    private digestOf(scope: LiveDigestScope): string | null {
        switch (scope.of) {
            case "scene": {
                const scene = this.deps.story.document(scope.storyId)?.scenes[scope.sceneId] ?? null;
                return scene ? sceneDigest(scene) : null;
            }
            case "character":
                return characterRecordDigest(characterAt(this.deps.cast.view(), scope.characterId));
            case "cast":
                return castDigest(this.deps.cast.view());
            // ⚠ A library this window does not hold hashes to something rather than to nothing, the
            // way a missing character record does and a missing scene does not. Every language is
            // read into memory on the way in, so arriving here without one means this machine failed
            // at something - and answering null would rule `unproven` on exactly the effect that
            // proves the two copies have parted company.
            case "translations":
                return translationsDigest(this.deps.localization.units(scope.locale));
            case "takes":
                return takesDigest(this.deps.voice.units(scope.locale));
            // A shard nobody holds hashes to a value too, for the libraries' reason: every one of
            // them is in memory before a session can start, so arriving here without one means this
            // machine failed at something.
            case "assets":
                return assetsDigest(this.deps.assets.records(scope.assetType));
            case "asset-groups":
                return assetGroupsDigest(this.deps.assets.folders(scope.category));
            // ⚠ A Surface, a component or a blueprint this window does not hold hashes to a value
            // rather than to nothing, with the cast's record and against a missing scene: both
            // interface documents are in memory before a session can start, so arriving here without
            // one means this machine failed at something - and answering null would rule
            // `unproven` on exactly the effect that proves the two copies have parted company.
            case "ui-surface":
                return uiSurfaceDigest(this.deps.ui.document(), scope.surfaceId);
            case "ui-component":
                return uiComponentDigest(this.deps.ui.document(), scope.componentId);
            case "ui-shell":
                return uiShellDigest(this.deps.ui.document());
            case "ui-blueprint":
                return uiBlueprintDigest(this.deps.ui.graphs(), scope.blueprintId);
            case "ui-graph-shell":
                return uiGraphShellDigest(this.deps.ui.graphs());
            // Whole-document, with the libraries and the asset shards, and absent hashes to a value
            // for their reason: all three are read as the workspace starts, so a machine that
            // reaches an effect without one has failed at something.
            case "dictionary":
                return dictionaryDigest(this.deps.dictionary.document());
            case "audio-tracks":
                return audioTracksDigest(this.deps.audioTracks.tracks());
            case "asset-sets":
                return assetSetsDigest(this.deps.assetSets.sets());
        }
    }

    /**
     * Whether one operation is too big to travel, and therefore must not be applied anywhere.
     *
     * **Checked here rather than in the rules**, because this is the only layer that knows how a
     * message is encoded, and checked *before* the host applies its own operation rather than when the
     * send fails: a host that applied an operation it then could not broadcast would hold a document
     * nobody else has, which is the divergence the digest exists to catch and the one thing worth
     * spending a JSON encode per operation to prevent.
     *
     * Confined to the verbs that can actually reach the cap, so an ordinary edit does not pay a JSON
     * encode: a whole character record is bounded by nothing, and a library batch is a whole exchange
     * file folded back in - a translated CSV of a few thousand rows is far past 16 KB. Everything
     * else is a line of prose and a few ids.
     *
     * ⚠ An import too large to travel is refused by name and said out loud, exactly as a fat
     * character record is. It is never split into several operations: an import is one gesture, and
     * the whole reason it has a batch verb is that the room must not watch it arrive in pieces.
     */
    private tooLarge(op: LiveOp): boolean {
        if (op.op !== "create-character" && op.op !== "update-character"
            && op.op !== "set-translations" && op.op !== "set-takes"
            && op.op !== "update-asset" && op.op !== "move-assets"
            && op.op !== "create-assets" && op.op !== "replace-asset-content"
            && op.op !== "delete-assets" && op.op !== "restore-asset-folder"
            // ⚠ Both interface verbs, and these are the ones most able to reach the cap: importing
            // a template restates hundreds of elements, and one graph's wiring is ten kilobytes in
            // the shipped skeleton. Refused by name rather than split - an interface arriving in
            // pieces would draw a screen nobody authored.
            && op.op !== "write-ui" && op.op !== "write-ui-graphs") {
            return false;
        }
        return new TextEncoder().encode(JSON.stringify(op)).length > TEAM_LIVE_PAYLOAD_LIMIT;
    }

    /** The host's own edit: applied, recorded as this window's, and broadcast. */
    private hostApply(
        session: ActiveSession,
        op: LiveOp,
        derived: LiveDerived | undefined,
        key?: string,
    ): LiveEffect | LiveRefusal {
        const host = session.host;
        if (!host) {
            throw new Error("hostApply on a session this window is a guest of");
        }
        if (this.tooLarge(op)) {
            const refusal: LiveRefusal = { kind: "refusal", clientId: "", reason: "too-large" };
            session.pendingBefore = null;
            this.noteRefusal(session, refusal, op.op);
            return refusal;
        }
        const answer = host.applyLocal(op, this.documentOf(session, op), derived);
        if (answer.kind === "refusal") {
            session.pendingBefore = null;
            this.noteRefusal(session, answer, op.op);
            return answer;
        }
        this.rememberDerived(session, answer.op, answer.derived);
        this.record(session, answer, session.pendingBefore, key);
        session.pendingBefore = null;
        session.rooms.say(session.room.id, answer);
        // The host's own delete forgets whatever claim stood on the row it removed, and that is a
        // change to the set like any other. Said after the effect, so nobody hears that a row is
        // free before they hear it is gone.
        this.broadcastClaims(session);
        return answer;
    }

    /** Take one of this window's own effects into the stack that Ctrl+Z reads. */
    private record(session: ActiveSession, effect: LiveEffect, before: LiveBefore | null, key?: string): void {
        // What the inverse will have to carry: the entries this row came with, so that undoing a
        // delete puts the translations and takes back too. `inverseOf` answers with an operation
        // and nothing else, which is the gap this closes.
        const derived = this.derivedOfDeleted(session, effect.op);
        const record: LiveEffectRecord = {
            effect,
            before,
            ...(derived === undefined ? {} : { derived }),
        };
        session.effects.record(record, key ?? effect.clientId);
        // An operation of this window's has landed, so whatever the host last said no to is over.
        // Left standing it would sit on the panel describing a gesture the author has moved past.
        this.publish(session, { lastRefusal: null });
    }

    /**
     * Note that a row arrived with entries derived from the effect that carried it.
     *
     * Against every row of a batch, because the entries belong to the gesture: a paste is one
     * operation carrying one set, and any one of its rows being deleted and put back has to bring
     * that set with it.
     */
    private rememberDerived(session: ActiveSession, op: LiveOp, derived: LiveDerived | undefined): void {
        if (!derived) {
            return;
        }
        if (op.op === "insert-block") {
            session.derivedByBlock.set(op.block.id, derived);
            return;
        }
        if (op.op === "insert-blocks") {
            for (const insert of op.inserts) {
                session.derivedByBlock.set(insert.block.id, derived);
            }
        }
    }

    /**
     * The entries the rows an operation removes arrived with, or undefined for an operation that
     * removes nothing.
     *
     * Merged across the rows of a batch rather than taken from the first of them: a selection can
     * hold rows from two different pastes, and an inverse carrying one paste's translations would
     * put half the words back. A locale's entries are keyed by text id and the ids of two pastes are
     * disjoint, so merging them is addition rather than a choice between them.
     */
    private derivedOfDeleted(session: ActiveSession, op: LiveOp): LiveDerived | undefined {
        const ids = op.op === "delete-block"
            ? [op.blockId]
            : op.op === "delete-blocks" ? op.blockIds : [];
        const found = ids
            .map(blockId => session.derivedByBlock.get(blockId))
            .filter((one): one is LiveDerived => one !== undefined);
        if (found.length <= 1) {
            return found[0];
        }
        const translations: Record<string, Record<string, LocalizationUnit>> = {};
        const voice: Record<string, Record<string, VoiceUnit>> = {};
        for (const one of found) {
            for (const [locale, units] of Object.entries(one.translations ?? {})) {
                translations[locale] = { ...translations[locale], ...units };
            }
            for (const [locale, units] of Object.entries(one.voice ?? {})) {
                voice[locale] = { ...voice[locale], ...units };
            }
        }
        return {
            ...(Object.keys(translations).length > 0 ? { translations } : {}),
            ...(Object.keys(voice).length > 0 ? { voice } : {}),
        };
    }

    private noteRefusal(session: ActiveSession, refusal: LiveRefusal, op: LiveOp["op"] | null): void {
        this.publish(session, {
            lastRefusal: op === null
                ? this.view.lastRefusal
                : {
                    reason: refusal.reason,
                    op,
                    ...(refusal.heldBy === undefined ? {} : { heldBy: refusal.heldBy }),
                },
        });
    }

    /* ---------------------------------------------------------------------- sink */

    /**
     * Where the story editor's gestures go while this session runs.
     *
     * The eleven mutators all ask, so nothing in the editor knows a session exists. `true` means
     * this session has the operation and the document must not be touched - the row moves when the
     * effect answering it comes back, which for a guest is a round trip and for a host is the next
     * statement.
     */
    private sinkFor(session: ActiveSession): StoryOpSink {
        return {
            handle: (storyId, op, derived): boolean => {
                if (this.active !== session || storyId !== session.storyId) {
                    // Another story, or a session that has ended: the mutator carries on exactly as
                    // it would with no sink at all.
                    return false;
                }
                if (session.host) {
                    this.hostApply(session, op, derived);
                    return true;
                }
                session.guest?.intend(op, { doc: "story", storyId }, derived);
                this.publish(session, {});
                // True even when the intent is refused later, and even for a session with neither
                // half built: what must never happen is this window changing a shared document on
                // its own initiative.
                return true;
            },
        };
    }

    /**
     * Where cast edits go while this session is running.
     *
     * The story sink's twin, and deliberately the same three lines of decision: a host applies its own
     * operation and broadcasts the effect, a guest sends an intent and changes nothing. What differs
     * is only that there is no document id to check - one cast per project.
     */
    private castSinkFor(session: ActiveSession): CharacterOpSink {
        return {
            handle: (op): boolean => {
                if (this.active !== session) {
                    // A session that has ended: the caller carries on exactly as it would with no
                    // sink at all.
                    return false;
                }
                if (session.host) {
                    this.hostApply(session, op, undefined);
                    return true;
                }
                if (this.tooLarge(op)) {
                    // Refused here rather than sent and dropped by the transport. A guest whose intent
                    // never leaves would sit waiting for a receipt that cannot come, re-sending it
                    // every three seconds for the rest of the session.
                    this.noteRefusal(session, { kind: "refusal", clientId: "", reason: "too-large" }, op.op);
                    return true;
                }
                session.guest?.intend(op, { doc: "characters" });
                this.publish(session, {});
                // True even when the intent is refused later, and even for a session with neither
                // half built: what must never happen is this window changing a shared document on
                // its own initiative.
                return true;
            },
        };
    }

    /**
     * Where translation and voice edits go while this session is running.
     *
     * **One sink for every document that is not a story and not the cast**, which is the only
     * place in this file documents share one, and they share it because the decision is identical:
     * none of them has a document id this window has to be holding for the operation to be about it
     * - the operation names its own language or its own asset type, and the three project tables
     * have only one address each. Six copies of these ten lines would be six places to remember the
     * size check.
     */
    private librarySinkFor(session: ActiveSession): {
        handle(op: LiveLocalizationOp | LiveVoiceOp | LiveAssetOp | LiveDictionaryOp
            | LiveAudioTrackOp | LiveAssetSetOp): boolean;
    } {
        return {
            handle: (op): boolean => {
                if (this.active !== session) {
                    // A session that has ended: the caller carries on exactly as it would with no
                    // sink at all.
                    return false;
                }
                if (session.host) {
                    this.hostApply(session, op, undefined);
                    return true;
                }
                if (this.tooLarge(op)) {
                    // Refused here rather than sent and dropped by the transport. A guest whose
                    // intent never leaves would wait for a receipt that cannot come, re-sending it
                    // every few seconds for the rest of the session.
                    this.noteRefusal(session, { kind: "refusal", clientId: "", reason: "too-large" }, op.op);
                    return true;
                }
                session.guest?.intend(op, this.documentOf(session, op));
                this.publish(session, {});
                // True even when the intent is refused later: what must never happen is this window
                // changing a shared document on its own initiative.
                return true;
            },
        };
    }

    /**
     * Where the interface editor's and the blueprint canvas's gestures go while this session runs.
     *
     * **One sink object holding two, because the two documents are one editing surface.** Their
     * decision is the cast sink's, twice: a host applies its own operation and broadcasts the
     * effect, a guest sends an intent and changes nothing. What is not shared is the address, which
     * is why they are two functions rather than one - a message names one document.
     */
    private interfaceSinkFor(session: ActiveSession): { ui: UIOpSink; graphs: UIGraphOpSink } {
        const take = (op: LiveUIOp | LiveUIGraphOp, document: LiveDocument): boolean => {
            if (this.active !== session) {
                // A session that has ended: the caller carries on exactly as it would with no sink.
                return false;
            }
            if (session.host) {
                this.hostApply(session, op, undefined);
                return true;
            }
            if (this.tooLarge(op)) {
                // Refused here rather than sent and dropped by the transport. A guest whose intent
                // never leaves would sit waiting for a receipt that cannot come, re-sending it every
                // three seconds for the rest of the session.
                this.noteRefusal(session, { kind: "refusal", clientId: "", reason: "too-large" }, op.op);
                return true;
            }
            session.guest?.intend(op, document);
            this.publish(session, {});
            // True even when the intent is refused later: what must never happen is this window
            // changing a shared document on its own initiative.
            return true;
        };
        return {
            ui: { handle: op => take(op, { doc: "ui" }) },
            graphs: { handle: op => take(op, { doc: "ui-graphs" }) },
        };
    }

    /**
     * Where the asset library's gestures go while this session is running.
     *
     * The library sink's shape with one addition, and the addition is the whole of what makes a file
     * shareable: an operation that adds or replaces one arrives here with the bytes it is bringing,
     * and those go on the wire beside it rather than inside it.
     */
    private assetSinkFor(session: ActiveSession): AssetOpSink {
        const library = this.librarySinkFor(session);
        return {
            handle: (op, blobs): boolean => {
                if (this.active !== session) {
                    return false;
                }
                // Held before the operation is stated, not after: a guest's intent may be answered
                // by the host before this window has finished its own send loop, and a receiver that
                // asked for a slice must find somebody holding it.
                if (blobs) {
                    for (const [transferId, bytes] of blobs) {
                        session.blobsOut.set(transferId, bytes);
                    }
                }
                const taken = library.handle(op as LiveAssetOp);
                if (taken && blobs) {
                    void this.sendBlobs(session, [...blobs.keys()]);
                }
                return taken;
            },
        };
    }

    /**
     * Where the asset library reads the files an operation named.
     *
     * A pull rather than a push, because an applier is synchronous and writing a file is not: the
     * record lands now and the library comes back for the bytes. See `AssetBlobPort`.
     */
    private blobPortFor(session: ActiveSession): AssetBlobPort {
        return {
            take: part => {
                if (this.active !== session) {
                    return null;
                }
                const state = session.blobsIn.take(part.transferId, part.digest);
                if (state.status === "complete") {
                    return state.bytes;
                }
                if (state.status === "corrupt") {
                    // Slices that do not add up to what the sender said. Asking again is the only
                    // repair there is, and it is better than writing a file that opens as garbage.
                    console.warn(`[live] transfer ${part.transferId} did not verify; asking again`);
                }
                return null;
            },
            request: part => {
                if (this.active !== session) {
                    return;
                }
                const missing = session.blobsIn.missing(part.transferId, chunkCountOf(part));
                const needed: LiveBlobNeeded = {
                    kind: "blob-needed",
                    by: session.self,
                    transferId: part.transferId,
                    // ⚠ Named one by one only while the list fits in a message. A file of any size
                    // has more slices than a `live.say` has room to list, and an empty list already
                    // means "all of it" - which is also the right answer when that many are missing.
                    missing: missing.length > MAX_NAMED_SLICES ? [] : missing,
                };
                session.rooms.say(session.room.id, needed);
            },
            arrived: part => ({
                slices: session.blobsIn.received(part.transferId),
                sent: session.blobsIn.sawLast(part.transferId, chunkCountOf(part)),
            }),
            abandon: part => {
                if (this.active !== session) {
                    return;
                }
                session.blobsIn.drop(part.transferId);
                session.blobsOut.delete(part.transferId);
                // Read by the send loop between turns: the machine that is sending this file learns
                // of the cancel through the deletion's applier like everybody else, and this is what
                // stops it partway rather than at the end.
                session.blobsDropped.add(part.transferId);
            },
        };
    }

    /**
     * Put one transfer's slices on the wire, a few at a time.
     *
     * ⚠ **Paced on purpose.** A thirty-megabyte file is a couple of thousand messages, and sending
     * them in one loop would sit in front of every operation anybody else states for as long as it
     * took. The gap is small enough that a transfer still finishes in seconds and large enough that
     * the room keeps answering.
     */
    private blobTurnDelayMs(): number {
        return hasExperimentalCondition(experimentalState(), "slow-live-transfer") ? SLOW_BLOB_TURN_MS : 0;
    }

    private async sendBlobs(session: ActiveSession, transferIds: readonly string[]): Promise<void> {
        for (const transferId of transferIds) {
            const bytes = session.blobsOut.get(transferId);
            if (!bytes) {
                continue;
            }
            const chunks = sliceBlob(transferId, bytes);
            for (let at = 0; at < chunks.length; at += 1) {
                if (this.active !== session || session.blobsDropped.has(transferId)) {
                    // Left the room, or the record this file was for has been deleted while it was
                    // going out. Either way the rest of it is bytes nobody will name.
                    break;
                }
                session.rooms.say(session.room.id, chunks[at]);
                if ((at + 1) % BLOBS_PER_TURN === 0) {
                    await new Promise<void>(resolve => this.deps.schedule(this.blobTurnDelayMs(), resolve));
                }
            }
        }
    }

    /**
     * A slice arriving, or somebody saying they are short of some.
     *
     * The second half is the only repair this channel has: nothing is acknowledged and nothing is
     * retransmitted on a timer, so a machine that finds itself short says exactly what it is short
     * of and whoever holds the file sends those again.
     */
    private onBlobMessage(session: ActiveSession, message: LiveBlobChunk | LiveBlobNeeded): void {
        if (message.kind === "blob") {
            if (session.blobsIn.accept(message)) {
                // A slice landing is the only moment a file that was waiting for one can become
                // writable, so it is the only moment the library is asked to try again.
                this.deps.assets.resumePayloads();
            }
            return;
        }
        if (message.by === session.self) {
            // This window's own request, coming back off the topic.
            return;
        }
        const bytes = session.blobsOut.get(message.transferId);
        if (!bytes) {
            // Somebody else is holding that file. Every message reaches the whole room, so the one
            // that has it answers and the rest of us do nothing.
            return;
        }
        const chunks = sliceBlob(message.transferId, bytes);
        const wanted = message.missing.length === 0
            ? chunks
            : chunks.filter(chunk => message.missing.includes(chunk.index));
        for (const chunk of wanted) {
            session.rooms.say(session.room.id, chunk);
        }
    }

    /** Every shard of one section, by asset type. What a folder deletion has to be recorded against. */
    private assetsOfCategory(category: string): Record<string, Readonly<Record<string, LiveAssetRecord>>> {
        const out: Record<string, Readonly<Record<string, LiveAssetRecord>>> = {};
        for (const assetType of this.deps.assets.shardTypes()) {
            if (assetCategoryOf(assetType) !== category) {
                continue;
            }
            const records = this.deps.assets.records(assetType);
            if (records) {
                out[assetType] = records;
            }
        }
        return out;
    }

    /* -------------------------------------------------------------------- states */

    private blocked(): LiveEntryFailure | null {
        if (this.active || this.view.phase !== "idle") {
            return { kind: "busy" };
        }
        // Asked rather than re-derived: the freeze latch is a module-level singleton, so freezing
        // again with a session's reason would REPLACE whatever is in the way rather than adding to
        // it - and the merge freeze is the one thing stopping an auto-save writing the author's own
        // side of a conflicted file over the merge's result.
        const refusal = refuseLiveSessionEntry(this.deps.freeze.reason());
        return refusal === null ? null : { kind: "frozen", refusal };
    }

    private async ready(): Promise<
        { project: LiveProjectIdentity; instance: string; rooms: LiveRooms } | LiveEntryFailure
    > {
        const project = await this.deps.project();
        if (project === null) {
            return { kind: "no-repository" };
        }
        if (project.remoteOrigin === null) {
            return { kind: "no-server" };
        }
        const instance = await this.deps.instance();
        if (instance === null) {
            return { kind: "no-instance" };
        }
        return { project, instance, rooms: this.deps.rooms(project.remoteOrigin) };
    }

    private async findRoom(
        rooms: LiveRooms,
        project: string,
        session: TeamLiveSession | string,
    ): Promise<TeamLiveSession | null> {
        if (typeof session !== "string") {
            return session;
        }
        const listed = await rooms.list(project);
        return listed.ok ? listed.value.find(one => one.id === session) ?? null : null;
    }

    private failEntry(failure: LiveEntryFailure): LiveEntryFailure {
        this.patch({ phase: "idle", entryFailure: failure });
        return failure;
    }

    /** Re-read everything about the running session, with `extra` written over the top. */
    private publish(session: ActiveSession, extra: Partial<LiveSessionView>): void {
        if (this.active !== session) {
            return;
        }
        this.patch({
            role: session.role,
            session: session.room,
            storyId: session.storyId,
            self: session.self,
            revision: session.room.revision ?? null,
            checkpoint: session.checkpoint,
            appliedSeq: session.host ? session.seq : session.guest?.appliedSeq ?? 0,
            pendingIntents: session.guest?.pending.length ?? 0,
            waitingForCatchUp: session.guest?.waitingForCatchUp ?? false,
            claims: session.host ? session.host.claims.snapshot().held : session.guest?.claimed ?? {},
            canUndo: session.effects.canUndo,
            canRedo: session.effects.canRedo,
            ...extra,
        });
    }

    private patch(partial: Partial<LiveSessionView>): void {
        this.set({ ...this.view, ...partial });
    }

    private set(view: LiveSessionView): void {
        this.view = view;
        for (const listener of [...this.listeners]) {
            try {
                listener(view);
            } catch (error) {
                // A panel that throws must never be able to stop a session from running.
                console.warn("[LiveSession] a view listener threw", error);
            }
        }
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
