import { describe, expect, it } from "vitest";
import { sceneDigest } from "@shared/live/sceneDigest";
import {
    storyRowClaimKey,
    type LiveCatchUp,
    type LiveDocument,
    type LiveEffect,
    type LiveIntent,
    type LiveOp,
    type LiveRefusal,
    type LiveRefusalReason,
} from "@shared/live/ops";
import type {
    StoryBlockId,
    StoryNoteBlock,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import {
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    updateBlockPayload,
} from "@/lib/workspace/services/story/storyModel";
import { DEFAULT_RESEND_AFTER_MS, LiveGuest, type LiveGuestOutbound } from "./liveGuest";

const STORY = "story-1";
const SELF = "guest-1";

/* ----------------------------------------------------------------- a document to edit */

function note(id: StoryBlockId, value: string = id): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value, role: "note" } },
    };
}

function makeScene(id: StorySceneId, ids: StoryBlockId[]): StoryScene {
    const scene: StoryScene = { id, name: `Scene ${id}`, runtimeName: id, rootBlockIds: [], blocks: {} };
    for (const blockId of ids) {
        insertBlockInScene(scene, note(blockId), { parentId: null, beforeBlockId: null });
    }
    return scene;
}

/* -------------------------------------------------------------- a clock that never ticks */

type FakeTimer = { at: number; run: () => void; spent: boolean };

/**
 * A clock and a scheduler that only move when a test says so, which is the whole point of injecting
 * them: waiting three real seconds for a re-send would be a test nobody runs.
 */
function makeClock() {
    let now = 0;
    const timers: FakeTimer[] = [];
    return {
        now: () => now,
        schedule(delayMs: number, run: () => void): () => void {
            const timer: FakeTimer = { at: now + delayMs, run, spent: false };
            timers.push(timer);
            return () => {
                timer.spent = true;
            };
        },
        /** Move time on, firing whatever falls due on the way - including anything armed while firing. */
        advance(ms: number): void {
            const until = now + ms;
            for (;;) {
                const due = timers
                    .filter(timer => !timer.spent && timer.at <= until)
                    .sort((a, b) => a.at - b.at)[0];
                if (!due) {
                    break;
                }
                due.spent = true;
                now = Math.max(now, due.at);
                due.run();
            }
            now = until;
        },
        get armed(): number {
            return timers.filter(timer => !timer.spent).length;
        },
    };
}

/* ---------------------------------------------------------------------- a guest to test */

type World = {
    guest: LiveGuest;
    scene: StoryScene;
    /** Every operation the applier was handed, in order. */
    applied: LiveOp[];
    /** Everything the guest put on the wire, in order. */
    sent: LiveGuestOutbound[];
    /** Every call the divergence seam got: the effect, and what this machine made of the scene. */
    digests: { effect: LiveEffect; digest: string | null }[];
    refusals: { refusal: LiveRefusal; intent: LiveIntent | null }[];
    clock: ReturnType<typeof makeClock>;
};

function makeWorld(options: { blocks?: StoryBlockId[]; withDigest?: boolean } = {}): World {
    const scene = makeScene("s1", options.blocks ?? ["a", "b", "c"]);
    const applied: LiveOp[] = [];
    const sent: LiveGuestOutbound[] = [];
    const digests: World["digests"] = [];
    const refusals: World["refusals"] = [];
    const clock = makeClock();

    const guest = new LiveGuest({
        self: SELF,
        applyOp: op => {
            applied.push(op);
            apply(scene, op);
        },
        send: message => sent.push(message),
        now: clock.now,
        schedule: clock.schedule,
        digestOf: scope => (scope.of === "scene" && scope.sceneId === scene.id ? sceneDigest(scene) : null),
        onDigest: options.withDigest
            ? (effect, compute) => digests.push({ effect, digest: compute(SCENE) })
            : undefined,
        onRefusal: (refusal, intent) => refusals.push({ refusal, intent }),
    });
    return { guest, scene, applied, sent, digests, refusals, clock };
}

function apply(scene: StoryScene, op: LiveOp): void {
    switch (op.op) {
        case "insert-block":
            insertBlockInScene(scene, structuredClone(op.block), op.target);
            return;
        case "update-block":
            updateBlockPayload(scene, op.blockId, op.payload);
            return;
        case "delete-block":
            deleteBlockFromScene(scene, op.blockId);
            return;
        case "move-block":
            moveBlockInScene(scene, op.blockId, op.target);
            return;
        case "rename-scene":
            scene.name = op.name;
            return;
        default:
            return;
    }
}

/* ------------------------------------------------------------------------- shorthands */

function insert(id: StoryBlockId, beforeBlockId: StoryBlockId | null = null): LiveOp {
    return { op: "insert-block", sceneId: "s1", block: note(id), target: { parentId: null, beforeBlockId } };
}

function rename(name: string): LiveOp {
    return { op: "rename-scene", sceneId: "s1", name };
}

const DOCUMENT: LiveDocument = { doc: "story", storyId: STORY };
const SCENE = { of: "scene", storyId: STORY, sceneId: "s1" } as const;

function effect(seq: number, op: LiveOp, extra: Partial<LiveEffect> = {}): LiveEffect {
    return { kind: "effect", by: "host", seq, document: DOCUMENT, op, ...extra };
}

function refusal(clientId: string, reason: LiveRefusalReason = "row-claimed"): LiveRefusal {
    return { kind: "refusal", clientId, reason, heldBy: "somebody" };
}

/** The row ids of the scene in document order, so an arrangement can be asserted as one line. */
function order(scene: StoryScene): StoryBlockId[] {
    return [...scene.rootBlockIds];
}

function intents(world: World): LiveIntent[] {
    return world.sent.filter((message): message is LiveIntent => message.kind === "intent");
}

/* ---------------------------------------------------------------------------- the rules */

describe("a guest that has asked for something", () => {
    it("sends the intent and changes nothing until the answer arrives", () => {
        const world = makeWorld();
        const intent = world.guest.intend(insert("x", "b"), DOCUMENT);

        expect(intents(world)).toEqual([intent]);
        expect(world.applied).toEqual([]);
        expect(order(world.scene)).toEqual(["a", "b", "c"]);
        expect(world.guest.pending).toEqual([intent]);

        world.guest.receive(effect(1, intent.op, { clientId: intent.clientId, by: SELF }));

        expect(order(world.scene)).toEqual(["a", "x", "b", "c"]);
        expect(world.guest.pending).toEqual([]);
    });

    it("mints a key for every intent and stamps the document it is about on it", () => {
        const world = makeWorld();
        const first = world.guest.intend(rename("One"), DOCUMENT);
        const second = world.guest.intend(rename("Two"), DOCUMENT);

        expect(first.clientId).not.toBe(second.clientId);
        expect(first.document).toEqual(DOCUMENT);
        expect(world.guest.pending).toEqual([first, second]);
    });

    it("applies the operation the effect carries, not the one it asked for", () => {
        const world = makeWorld();
        // The anchor row was deleted a moment ago, so the host landed the insert somewhere else and
        // said so. What the guest applies is the host's target, never its own.
        const intent = world.guest.intend(insert("x", "b"), DOCUMENT);
        const landed = insert("x", "c");
        world.guest.receive(effect(1, landed, { clientId: intent.clientId, by: SELF }));

        expect(world.applied).toEqual([landed]);
        expect(order(world.scene)).toEqual(["a", "b", "x", "c"]);
    });

    it("applies what other people did, in the order the host did it", () => {
        const world = makeWorld();
        world.guest.receive(effect(1, insert("x", "a"), { by: "guest-2" }));
        world.guest.receive(effect(2, { op: "delete-block", sceneId: "s1", blockId: "b" }, { by: "guest-2" }));

        expect(order(world.scene)).toEqual(["x", "a", "c"]);
        expect(world.guest.appliedSeq).toBe(2);
    });
});

describe("an intent that goes unanswered", () => {
    it("is sent again unchanged, with the same key, once the wait is long enough", () => {
        const world = makeWorld();
        const intent = world.guest.intend(rename("One"), DOCUMENT);

        world.clock.advance(DEFAULT_RESEND_AFTER_MS - 1);
        expect(intents(world)).toHaveLength(1);

        world.clock.advance(1);
        const seen = intents(world);
        expect(seen).toHaveLength(2);
        expect(seen[1]).toBe(intent);
        expect(seen[1].clientId).toBe(intent.clientId);
    });

    it("keeps going while the silence lasts, then settles on the answer without applying twice", () => {
        const world = makeWorld();
        const intent = world.guest.intend(insert("x"), DOCUMENT);

        world.clock.advance(DEFAULT_RESEND_AFTER_MS * 3);
        expect(intents(world)).toHaveLength(4);

        world.guest.receive(effect(1, intent.op, { clientId: intent.clientId, by: SELF }));
        expect(world.applied).toEqual([intent.op]);
        expect(order(world.scene)).toEqual(["a", "b", "c", "x"]);

        // The host answered a repeat with the answer it already gave, so the same effect can arrive
        // as many times as the intent went out.
        world.guest.receive(effect(1, intent.op, { clientId: intent.clientId, by: SELF }));
        expect(world.applied).toEqual([intent.op]);
        expect(order(world.scene)).toEqual(["a", "b", "c", "x"]);
    });

    it("stops the clock once nothing is outstanding", () => {
        const world = makeWorld();
        const intent = world.guest.intend(rename("One"), DOCUMENT);
        world.guest.receive(effect(1, intent.op, { clientId: intent.clientId, by: SELF }));

        expect(world.clock.armed).toBe(0);
        world.clock.advance(DEFAULT_RESEND_AFTER_MS * 5);
        expect(intents(world)).toHaveLength(1);
    });

    it("re-sends only the one that is overdue", () => {
        const world = makeWorld();
        const first = world.guest.intend(rename("One"), DOCUMENT);
        world.clock.advance(DEFAULT_RESEND_AFTER_MS - 100);
        const second = world.guest.intend(rename("Two"), DOCUMENT);
        world.clock.advance(100);

        expect(intents(world)).toEqual([first, second, first]);
    });

    it("gives up its timer when the session closes", () => {
        const world = makeWorld();
        world.guest.intend(rename("One"), DOCUMENT);
        world.guest.close();

        world.clock.advance(DEFAULT_RESEND_AFTER_MS * 2);
        expect(intents(world)).toHaveLength(1);
        expect(world.guest.pending).toEqual([]);
    });
});

describe("a refusal", () => {
    it("settles the intent, applies nothing, and says so", () => {
        const world = makeWorld();
        const intent = world.guest.intend({ op: "update-block", sceneId: "s1", blockId: "a", payload: note("a", "typed").payload }, DOCUMENT);
        const no = refusal(intent.clientId);
        world.guest.receive(no);

        expect(world.applied).toEqual([]);
        expect(world.guest.pending).toEqual([]);
        expect(world.refusals).toEqual([{ refusal: no, intent }]);

        world.clock.advance(DEFAULT_RESEND_AFTER_MS * 2);
        expect(intents(world)).toHaveLength(1);
    });

    it("is ignored when it answers somebody else's intent", () => {
        const world = makeWorld();
        const intent = world.guest.intend(rename("One"), DOCUMENT);
        world.guest.receive(refusal("guest-2:1"));

        expect(world.refusals).toEqual([]);
        expect(world.guest.pending).toEqual([intent]);
    });
});

describe("a gap in the sequence", () => {
    it("asks to be caught up, naming the last sequence it applied", () => {
        const world = makeWorld();
        world.guest.receive(effect(1, rename("One"), { by: "guest-2" }));
        world.guest.receive(effect(4, rename("Four"), { by: "guest-2" }));

        expect(world.sent).toEqual([{ kind: "resync", by: SELF, after: 1 }]);
        expect(world.guest.waitingForCatchUp).toBe(true);
        // Nothing past the hole is applied, because the host's order is the only order there is.
        expect(world.scene.name).toBe("One");
        expect(world.guest.appliedSeq).toBe(1);
    });

    it("asks once, however many effects arrive while it waits", () => {
        const world = makeWorld();
        world.guest.receive(effect(1, rename("One"), { by: "guest-2" }));
        world.guest.receive(effect(4, rename("Four"), { by: "guest-2" }));
        world.guest.receive(effect(5, rename("Five"), { by: "guest-2" }));
        world.guest.receive(effect(6, rename("Six"), { by: "guest-2" }));

        expect(world.sent).toHaveLength(1);
    });

    it("applies the catch-up in order and does not apply twice what arrived during the gap", () => {
        const world = makeWorld();
        world.guest.receive(effect(1, insert("p"), { by: "guest-2" }));
        // Arrives ahead of the hole and is held.
        world.guest.receive(effect(4, insert("s"), { by: "guest-2" }));

        const caught: LiveCatchUp = {
            kind: "catch-up",
            to: SELF,
            effects: [
                effect(2, insert("q"), { by: "guest-2" }),
                effect(3, insert("r"), { by: "guest-2" }),
                // The host's log holds the one that arrived early too, so the answer overlaps.
                effect(4, insert("s"), { by: "guest-2" }),
            ],
        };
        world.guest.receive(caught);

        expect(world.applied.map(op => (op.op === "insert-block" ? op.block.id : op.op))).toEqual(["p", "q", "r", "s"]);
        expect(order(world.scene)).toEqual(["a", "b", "c", "p", "q", "r", "s"]);
        expect(world.guest.appliedSeq).toBe(4);
        expect(world.guest.waitingForCatchUp).toBe(false);
    });

    it("settles an intent the catch-up answers, and applies the operation the effect carries", () => {
        const world = makeWorld();
        const intent = world.guest.intend(insert("x", "b"), DOCUMENT);
        world.guest.receive(effect(2, rename("Two"), { by: "guest-2" }));

        const landed = insert("x", "c");
        world.guest.receive({
            kind: "catch-up",
            to: SELF,
            effects: [
                effect(1, landed, { clientId: intent.clientId, by: SELF }),
                effect(2, rename("Two"), { by: "guest-2" }),
            ],
        });

        expect(world.guest.pending).toEqual([]);
        expect(world.applied).toEqual([landed, rename("Two")]);
        expect(order(world.scene)).toEqual(["a", "b", "x", "c"]);
    });

    it("carries on asking once a later effect shows the hole is still there", () => {
        const world = makeWorld();
        world.guest.receive(effect(3, rename("Three"), { by: "guest-2" }));
        world.guest.receive({ kind: "catch-up", to: SELF, effects: [] });
        world.guest.receive(effect(4, rename("Four"), { by: "guest-2" }));

        expect(world.sent).toEqual([
            { kind: "resync", by: SELF, after: 0 },
            { kind: "resync", by: SELF, after: 0 },
        ]);
    });
});

describe("what a guest ignores", () => {
    it("ignores a catch-up addressed to somebody else", () => {
        const world = makeWorld();
        world.guest.receive(effect(1, rename("One"), { by: "guest-2" }));
        world.guest.receive(effect(3, rename("Three"), { by: "guest-2" }));
        world.guest.receive({
            kind: "catch-up",
            to: "guest-2",
            effects: [effect(2, rename("Two"), { by: "guest-2" })],
        });

        expect(world.applied).toEqual([rename("One")]);
        expect(world.guest.appliedSeq).toBe(1);
        expect(world.guest.waitingForCatchUp).toBe(true);
    });

    it("ignores its own messages coming back off the topic", () => {
        const world = makeWorld();
        const intent = world.guest.intend(rename("One"), DOCUMENT);
        world.guest.receive(intent);
        world.guest.receive({ kind: "resync", by: SELF, after: 0 });
        world.guest.receive({ kind: "claim", key: storyRowClaimKey("a"), holding: true });

        expect(world.applied).toEqual([]);
        expect(world.guest.pending).toEqual([intent]);
        // Nothing a guest can hear makes a row its own. Only the host holds a claim, and what a
        // guest learns about one arrives as a `claims` set and in no other way.
        expect(world.guest.claimed).toEqual({});
    });

    it("asks for a row and holds nothing until the set says so", () => {
        const world = makeWorld();
        world.guest.claim(storyRowClaimKey("a"), true);

        expect(world.sent).toEqual([{ kind: "claim", key: storyRowClaimKey("a"), holding: true }]);
        // No optimism: the ask changes nothing here, and the row is somebody else's until the host
        // broadcasts a set that names this author on it.
        expect(world.guest.claimed).toEqual({});

        world.guest.claim(storyRowClaimKey("a"), false);
        expect(world.sent).toEqual([
            { kind: "claim", key: storyRowClaimKey("a"), holding: true },
            { kind: "claim", key: storyRowClaimKey("a"), holding: false },
        ]);
    });

    it("records a claims snapshot for the interface and applies nothing", () => {
        const world = makeWorld();
        world.guest.receive({ kind: "claims", seq: 2, held: { a: "Ada" } });

        expect(world.guest.claimed).toEqual({ a: "Ada" });
        expect(world.applied).toEqual([]);

        // Whole snapshots, so the newest one is the truth and an older one overtaking it is not.
        world.guest.receive({ kind: "claims", seq: 3, held: { b: "Bo" } });
        expect(world.guest.claimed).toEqual({ b: "Bo" });
        world.guest.receive({ kind: "claims", seq: 1, held: { a: "Ada" } });
        expect(world.guest.claimed).toEqual({ b: "Bo" });
    });

    it("ignores anything it cannot read", () => {
        const world = makeWorld();
        for (const nonsense of [null, undefined, 42, "effect", {}, { kind: "gossip" }]) {
            world.guest.receive(nonsense);
        }

        expect(world.applied).toEqual([]);
        expect(world.sent).toEqual([]);
    });
});

describe("the divergence seam", () => {
    it("gets the effect and the digest this machine computed, and decides nothing", () => {
        const world = makeWorld({ withDigest: true });
        const applied = insert("x");
        const arrived = effect(1, applied, {
            by: "guest-2",
            digests: [{ scope: SCENE, hash: "whatever-the-host-made-of-it" }],
        });
        world.guest.receive(arrived);

        expect(world.digests).toEqual([{ effect: arrived, digest: sceneDigest(world.scene) }]);
        // The digests disagree, and the guest carries on regardless: what to do about that belongs
        // to whoever supplied the seam.
        expect(world.digests[0].digest).not.toBe(arrived.digests?.[0].hash);
        expect(order(world.scene)).toEqual(["a", "b", "c", "x"]);
        expect(world.guest.appliedSeq).toBe(1);
    });

    it("is left alone by an effect that carries no digest", () => {
        const world = makeWorld({ withDigest: true });
        world.guest.receive(effect(1, { op: "rename-story", name: "Renamed" }, { by: "guest-2" }));

        expect(world.digests).toEqual([]);
    });
});
