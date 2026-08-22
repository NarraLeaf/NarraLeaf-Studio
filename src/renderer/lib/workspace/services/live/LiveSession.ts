import { LiveDivergenceGuard, LiveGuest, LiveHost, type LiveDivergence } from "@/lib/live";
import { captureBefore, type LiveBefore } from "@/lib/live/inverse";
import { refuseLiveSessionEntry } from "@/lib/team/liveSessionEntry";
import {
    isLiveMessage,
    type LiveDerived,
    type LiveEffect,
    type LiveMessage,
    type LiveOp,
    type LiveRefusal,
    type LiveResync,
} from "@shared/live/ops";
import type { StoryBlockId, StoryId, StoryScene, StorySceneId } from "@shared/types/story";
import type { TeamLiveEvent, TeamLiveSession } from "@shared/types/team";
import type { StoryOpSink } from "../story/StoryService";
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
    /** Set once the copies stop agreeing; the session ends on the next turn of the loop. */
    divergence: LiveDivergence | null;
    /** How many undo or redo steps this window has sent, for the keys their answers arrive under. */
    steps: number;
    stopListening: () => void;
    stopWatching: () => void;
};

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
    public async join(input: { session: TeamLiveSession | string; storyId: StoryId }): Promise<LiveEntryFailure | null> {
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
            const joined = await ready.rooms.join(room.id);
            if (!joined.ok) {
                return this.failEntry({ kind: "refused", problem: joined.problem });
            }
            await this.enter({
                room: joined.value,
                rooms: ready.rooms,
                project: ready.project,
                self: ready.instance,
                storyId: input.storyId,
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
        const session = this.active;
        if (!session || session.storyId !== storyId) {
            return;
        }
        if (session.host) {
            session.host.claimLocal(blockId, holding);
            this.broadcastClaims(session);
            this.publish(session, {});
            return;
        }
        // Nothing is written here and nothing on screen moves. A guest holds the row when a set
        // arrives naming it, and never because it asked.
        session.guest?.claimRow(blockId, holding);
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
     *
     * ⚠ A lapse travels on the next thing that happens in the room rather than the instant it falls
     * due, because the store keeps no timers and this has no tick to sweep on. Nothing is at stake
     * in the delay: the host expires a claim while answering the operation that asks about it, so a
     * row is free to be written the moment somebody tries, whatever the last set said.
     */
    private broadcastClaims(session: ActiveSession): void {
        if (session.host && session.host.claims.revision !== session.claimsSeq) {
            this.sendClaims(session);
        }
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
        if (!document) {
            // The story is not held here any more, so nothing can be read to invert against.
            this.patch({ undoRefusal: "no-record" });
            return false;
        }
        const plan = session.effects.plan(direction, { self: session.self, document });
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
        const intent = guest.intend(plan.op, plan.derived);
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
        await this.deps.freeze.arm({
            session: input.room.id,
            writable: [this.deps.storyDocumentPath(input.storyId)],
        });

        const session: ActiveSession = {
            room: input.room,
            rooms: input.rooms,
            project: input.project,
            role,
            storyId: input.storyId,
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
            divergence: null,
            steps: 0,
            stopListening: () => undefined,
            stopWatching: () => undefined,
        };
        this.active = session;

        if (role === "host") {
            session.host = new LiveHost({
                self: input.self,
                story: input.storyId,
                readScene: sceneId => this.readScene(session, sceneId),
                applyOp: op => this.applyOp(session, op),
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
        } else {
            session.guard = new LiveDivergenceGuard();
            session.guest = new LiveGuest({
                self: input.self,
                story: input.storyId,
                applyOp: (op, derived) => this.applyOp(session, op, derived),
                send: message => session.rooms.say(session.room.id, message),
                now: () => this.deps.now(),
                schedule: (delayMs, run) => this.deps.schedule(delayMs, run),
                readScene: sceneId => this.readScene(session, sceneId),
                onDigest: (effect, digest) => {
                    const ruling = session.guard?.check(effect, digest);
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
        session.stopListening();
        session.stopWatching();
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
        if (session.host) {
            const answer = session.host.receive(payload, from);
            if (answer) {
                if (answer.kind === "effect") {
                    this.rememberDerived(session, answer.op, answer.derived);
                    if (answer.derived) {
                        this.deps.story.adoptDerived(answer.derived);
                    }
                }
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
    private applyOp(session: ActiveSession, op: LiveOp, derived?: LiveDerived): void {
        const document = this.deps.story.document(session.storyId);
        session.pendingBefore = document ? captureBefore(op, document) : null;
        this.deps.story.applyOp(session.storyId, op);
        this.rememberDerived(session, op, derived);
        if (derived) {
            this.deps.story.adoptDerived(derived);
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
        const answer = host.applyLocal(op, derived);
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
        const derived = effect.op.op === "delete-block"
            ? session.derivedByBlock.get(effect.op.blockId)
            : undefined;
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

    /** Note that a row arrived with entries derived from the effect that carried it. */
    private rememberDerived(session: ActiveSession, op: LiveOp, derived: LiveDerived | undefined): void {
        if (derived && op.op === "insert-block") {
            session.derivedByBlock.set(op.block.id, derived);
        }
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
            handle: (storyId, op): boolean => {
                if (this.active !== session || storyId !== session.storyId) {
                    // Another story, or a session that has ended: the mutator carries on exactly as
                    // it would with no sink at all.
                    return false;
                }
                if (session.host) {
                    this.hostApply(session, op, undefined);
                    return true;
                }
                session.guest?.intend(op);
                this.publish(session, {});
                // True even when the intent is refused later, and even for a session with neither
                // half built: what must never happen is this window changing a shared document on
                // its own initiative.
                return true;
            },
        };
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
            claims: session.host ? session.host.claims.snapshot().held : session.guest?.claimedRows ?? {},
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
