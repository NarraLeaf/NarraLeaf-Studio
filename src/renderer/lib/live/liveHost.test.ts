import { describe, expect, it } from "vitest";
import { sceneDigest } from "@shared/live/sceneDigest";
import type {
    LiveEffect,
    LiveIntent,
    LiveMessage,
    LiveOp,
    LiveRefusal,
    LiveRefusalReason,
} from "@shared/live/ops";
import type {
    StoryBlock,
    StoryBlockId,
    StoryControlBlock,
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
import { LiveHost, type LiveOutbound } from "./liveHost";

const STORY = "story-1";

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

function group(id: StoryBlockId): StoryControlBlock {
    return { id, kind: "control", parentId: null, childrenIds: [], payload: { control: "sequence" } };
}

/** A scene built the way the story service builds one, so the tests edit a real document. */
function makeScene(id: StorySceneId, rows: { block: StoryBlock; parentId?: StoryBlockId | null }[]): StoryScene {
    const scene: StoryScene = { id, name: `Scene ${id}`, runtimeName: id, rootBlockIds: [], blocks: {} };
    for (const row of rows) {
        insertBlockInScene(scene, row.block, { parentId: row.parentId ?? null, beforeBlockId: null });
    }
    return scene;
}

/** The row ids of a scene in document order, flattened, so an arrangement can be asserted as one line. */
function order(scene: StoryScene, parentId: StoryBlockId | null = null): StoryBlockId[] {
    const ids = parentId === null ? scene.rootBlockIds : scene.blocks[parentId].childrenIds;
    return ids.flatMap(id => [id, ...order(scene, id)]);
}

/* --------------------------------------------------------------------- a host to test */

type World = {
    host: LiveHost;
    scenes: Record<StorySceneId, StoryScene>;
    story: { name: string; entrySceneId: StorySceneId | null; chapterIds: readonly string[] };
    /** Every operation the applier was actually handed, in order. */
    applied: LiveOp[];
};

function makeWorld(options: {
    scenes?: StoryScene[];
    members?: string[];
    /** Block id to the instance holding it, standing in for the claim store a later item owns. */
    claims?: Record<StoryBlockId, string>;
    receiptLimit?: number;
} = {}): World {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const scene of options.scenes ?? [makeScene("s1", [{ block: note("a") }, { block: note("b") }, { block: note("c") }])]) {
        scenes[scene.id] = scene;
    }
    const story = { name: "Skeleton", entrySceneId: "s1" as StorySceneId | null, chapterIds: ["c1", "c2"] as readonly string[] };
    const applied: LiveOp[] = [];
    let seq = 0;

    const world: World = {
        scenes,
        story,
        applied,
        host: new LiveHost({
            self: "host",
            story: STORY,
            readScene: id => scenes[id] ?? null,
            applyOp: op => {
                applied.push(op);
                apply(scenes, story, op);
            },
            nextSeq: () => ++seq,
            isMember: options.members ? instance => options.members?.includes(instance) ?? false : undefined,
            claimBlocking: options.claims
                // A real predicate answers with the account holding the row; here the instance ids
                // stand in for accounts, which is all the host needs to be told.
                ? (blockId, by) => {
                    const holder = options.claims?.[blockId];
                    return holder && holder !== by ? holder : null;
                }
                : undefined,
            receiptLimit: options.receiptLimit,
        }),
    };
    return world;
}

function apply(scenes: Record<StorySceneId, StoryScene>, story: World["story"], op: LiveOp): void {
    switch (op.op) {
        case "insert-block":
            // A clone, because the block arrived from somebody else's memory and the document keeps
            // what it is given - the same thing writing it through IPC would do.
            insertBlockInScene(scenes[op.sceneId], structuredClone(op.block), op.target);
            return;
        case "update-block":
            updateBlockPayload(scenes[op.sceneId], op.blockId, op.payload);
            return;
        case "delete-block":
            deleteBlockFromScene(scenes[op.sceneId], op.blockId);
            return;
        case "move-block":
            moveBlockInScene(scenes[op.sceneId], op.blockId, op.target);
            return;
        case "set-block-disabled": {
            const block = scenes[op.sceneId].blocks[op.blockId];
            if (op.disabled) {
                block.disabled = true;
            } else {
                delete block.disabled;
            }
            return;
        }
        case "rename-scene":
            scenes[op.sceneId].name = op.name;
            return;
        case "set-entry-scene":
            story.entrySceneId = op.sceneId;
            return;
        case "rename-story":
            story.name = op.name;
            return;
        case "reorder-chapters":
            story.chapterIds = [...op.chapterIds];
            return;
    }
}

let nextClientId = 0;

function intent(op: LiveOp, clientId: string = `c${++nextClientId}`): LiveIntent {
    return { kind: "intent", clientId, story: STORY, op };
}

function send(world: World, op: LiveOp, from = "guest-1"): LiveOutbound | null {
    return world.host.receive(intent(op), from);
}

function asEffect(outbound: LiveOutbound | null): LiveEffect {
    expect(outbound?.kind).toBe("effect");
    return outbound as LiveEffect;
}

function asRefusal(outbound: LiveOutbound | null): LiveRefusal {
    expect(outbound?.kind).toBe("refusal");
    return outbound as LiveRefusal;
}

/* ---------------------------------------------------------------------------- the rules */

describe("a live host turning intents into effects", () => {
    it("applies intents one at a time, in arrival order, and numbers what it did", () => {
        const world = makeWorld();
        const first = asEffect(send(world, { op: "rename-scene", sceneId: "s1", name: "Corridor" }));
        const second = asEffect(send(world, { op: "rename-scene", sceneId: "s1", name: "Rooftop" }));

        expect([first.seq, second.seq]).toEqual([1, 2]);
        expect(world.applied.map(op => (op.op === "rename-scene" ? op.name : ""))).toEqual(["Corridor", "Rooftop"]);
        expect(world.scenes.s1.name).toBe("Rooftop");
        expect(world.host.log.after(0).map(effect => effect.seq)).toEqual([1, 2]);
    });

    it("says who asked, on every effect", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" }, "guest-7")).by).toBe("guest-7");
    });

    it("carries a paste's derived entries on to the room", () => {
        // Nobody else can look them up: the copier read them out of its own memory at the moment of
        // copying, so if the effect does not carry them they exist on one machine only.
        const world = makeWorld();
        const derived = { translations: { ja: { "text-new": { target: "遅いよ。", sourceHash: "h", status: "reviewed" as const } } } };
        const effect = asEffect(world.host.receive(
            {
                kind: "intent",
                clientId: "paste",
                story: STORY,
                op: { op: "insert-block", sceneId: "s1", block: note("new"), target: { parentId: null } },
                derived,
            },
            "guest-1",
        ));

        expect(effect.derived).toEqual(derived);
    });
});

describe("an intent that arrives twice", () => {
    it("produces one effect, and the repeat gets the original back", () => {
        const world = makeWorld();
        const op: LiveOp = { op: "insert-block", sceneId: "s1", block: note("new"), target: { parentId: null, beforeBlockId: "b" } };
        const first = world.host.receive(intent(op, "retry-me"), "guest-1");
        const again = world.host.receive(intent(op, "retry-me"), "guest-1");

        expect(again).toBe(first);
        expect(world.applied).toHaveLength(1);
        expect(world.host.log.length).toBe(1);
        expect(order(world.scenes.s1)).toEqual(["a", "new", "b", "c"]);
    });

    it("answers a repeated refusal with the same refusal", () => {
        const world = makeWorld();
        const op: LiveOp = { op: "update-block", sceneId: "s1", blockId: "gone", payload: note("gone").payload };
        const first = world.host.receive(intent(op, "retry-me"), "guest-1");

        expect(world.host.receive(intent(op, "retry-me"), "guest-1")).toBe(first);
    });

    it("applies a retry that arrives after its answer has been forgotten", () => {
        // What the bound on the receipt memory costs, stated as a test so nobody discovers it as a
        // surprise: the answer to `first` is dropped once two later intents have been answered, and
        // the third copy of it is an intent the host has never seen.
        const world = makeWorld({ receiptLimit: 2 });
        const op: LiveOp = { op: "rename-scene", sceneId: "s1", name: "Corridor" };
        const first = asEffect(world.host.receive(intent(op, "old-news"), "guest-1"));
        send(world, { op: "rename-story", name: "Rain" });
        send(world, { op: "rename-story", name: "Snow" });
        const late = asEffect(world.host.receive(intent(op, "old-news"), "guest-1"));

        expect(late).not.toBe(first);
        expect(late.seq).toBeGreaterThan(first.seq);
    });
});

describe("an operation on a row that is gone", () => {
    const cases: { name: string; op: LiveOp }[] = [
        { name: "update", op: { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "edited").payload } },
        { name: "delete", op: { op: "delete-block", sceneId: "s1", blockId: "b" } },
        { name: "disable", op: { op: "set-block-disabled", sceneId: "s1", blockId: "b", disabled: true } },
        { name: "move", op: { op: "move-block", sceneId: "s1", blockId: "b", target: { parentId: null, beforeBlockId: "a" } } },
    ];

    for (const { name, op } of cases) {
        it(`refuses a ${name} with row-gone and changes nothing`, () => {
            const world = makeWorld();
            send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });
            const before = sceneDigest(world.scenes.s1);

            const refusal = asRefusal(send(world, op));

            expect(refusal.reason).toBe("row-gone");
            expect(sceneDigest(world.scenes.s1)).toBe(before);
            expect(world.applied).toHaveLength(1);
        });
    }

    it("says the row is gone and nothing whatever about the words", () => {
        // The interface built on this tells the author their line has vanished and leaves the box
        // exactly as they left it. A refusal that carried anything else - a payload to fall back to,
        // a flag, a scene to reload - would be an invitation to throw away what they had typed.
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });
        const refusal = asRefusal(send(world, { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload }));

        expect(Object.keys(refusal).sort()).toEqual(["clientId", "kind", "reason"]);
    });
});

describe("an insert aimed at a row that has been deleted", () => {
    it("lands where that row was, and says so", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "b" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "new", "c"]);
        // The effect carries the operation as APPLIED: a guest replaying it must land in the same
        // place, and it was never told about the anchor the sender was aiming at.
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: "c" });
    });

    it("lands at the end when the deleted row was the last one", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "c" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "b", "new"]);
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: null });
    });

    it("walks past a second deleted row to the first one still standing", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "b" });
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "b" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "new"]);
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: null });
    });

    it("lands where a deleted group stood when the row was inside it", () => {
        const world = makeWorld({
            scenes: [makeScene("s1", [
                { block: note("a") },
                { block: group("g") },
                { block: note("inside"), parentId: "g" },
                { block: note("z") },
            ])],
        });
        send(world, { op: "delete-block", sceneId: "s1", blockId: "g" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: "g", beforeBlockId: "inside" },
        }));

        expect(order(world.scenes.s1)).toEqual(["a", "new", "z"]);
        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: "z" });
    });

    it("refuses an anchor it never saw, rather than inventing a place for it", () => {
        const world = makeWorld();
        const refusal = asRefusal(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "never-existed" },
        }));

        expect(refusal.reason).toBe("anchor-gone");
        expect(world.applied).toHaveLength(0);
    });
});

describe("rearranging a scene", () => {
    it("refuses a move whose destination is gone, and does nothing", () => {
        const world = makeWorld();
        send(world, { op: "delete-block", sceneId: "s1", blockId: "c" });
        const before = sceneDigest(world.scenes.s1);

        const refusal = asRefusal(send(world, {
            op: "move-block",
            sceneId: "s1",
            blockId: "a",
            target: { parentId: null, beforeBlockId: "c" },
        }));

        expect(refusal.reason).toBe("anchor-gone");
        expect(sceneDigest(world.scenes.s1)).toBe(before);
    });

    it("applies both moves when two people rearrange one scene", () => {
        // There is no conflict here to detect. Two moves are two moves, and the arrangement the room
        // ends up with is the one the second author saw themselves make.
        const world = makeWorld();
        asEffect(world.host.receive(intent({ op: "move-block", sceneId: "s1", blockId: "c", target: { parentId: null, beforeBlockId: "a" } }), "guest-1"));
        asEffect(world.host.receive(intent({ op: "move-block", sceneId: "s1", blockId: "a", target: { parentId: null, beforeBlockId: null } }), "guest-2"));

        expect(order(world.scenes.s1)).toEqual(["c", "b", "a"]);
        expect(world.applied).toHaveLength(2);
    });
});

describe("single-valued operations", () => {
    it("lets the last writer win, with no claim and no refusal", () => {
        const world = makeWorld();
        const cases: { first: LiveOp; second: LiveOp; read: () => unknown; expected: unknown }[] = [
            {
                first: { op: "rename-scene", sceneId: "s1", name: "Corridor" },
                second: { op: "rename-scene", sceneId: "s1", name: "Rooftop" },
                read: () => world.scenes.s1.name,
                expected: "Rooftop",
            },
            {
                first: { op: "rename-story", name: "Rain" },
                second: { op: "rename-story", name: "Snow" },
                read: () => world.story.name,
                expected: "Snow",
            },
            {
                first: { op: "set-entry-scene", sceneId: null },
                second: { op: "set-entry-scene", sceneId: "s1" },
                read: () => world.story.entrySceneId,
                expected: "s1",
            },
            {
                first: { op: "reorder-chapters", chapterIds: ["c2", "c1"] },
                second: { op: "reorder-chapters", chapterIds: ["c1", "c2"] },
                read: () => world.story.chapterIds,
                expected: ["c1", "c2"],
            },
        ];

        for (const testCase of cases) {
            asEffect(world.host.receive(intent(testCase.first), "guest-1"));
            asEffect(world.host.receive(intent(testCase.second), "guest-2"));
            expect(testCase.read()).toEqual(testCase.expected);
        }
    });
});

describe("the digest an effect carries", () => {
    it("is the scene after applying, and changes when the scene does", () => {
        const world = makeWorld();
        const first = asEffect(send(world, { op: "delete-block", sceneId: "s1", blockId: "b" }));
        expect(first.sceneDigest).toBe(sceneDigest(world.scenes.s1));

        const second = asEffect(send(world, { op: "rename-scene", sceneId: "s1", name: "Corridor" }));
        expect(second.sceneDigest).toBe(sceneDigest(world.scenes.s1));
        expect(second.sceneDigest).not.toBe(first.sceneDigest);
    });

    it("is absent from the operations that are about the story rather than a scene", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" })).sceneDigest).toBeUndefined();
        expect(asEffect(send(world, { op: "reorder-chapters", chapterIds: ["c2", "c1"] })).sceneDigest).toBeUndefined();
        expect(asEffect(send(world, { op: "set-entry-scene", sceneId: "s1" })).sceneDigest).toBeUndefined();
    });
});

describe("an intent the host will not read", () => {
    const cases: { name: string; make: (world: World) => LiveOutbound | null; reason: LiveRefusalReason }[] = [
        {
            name: "a vocabulary this build does not have",
            make: world => world.host.receive(intent({ op: "burn-it-down" } as unknown as LiveOp), "guest-1"),
            reason: "unknown-op",
        },
        {
            name: "an operation that is not an object at all",
            make: world => world.host.receive(intent(undefined as unknown as LiveOp), "guest-1"),
            reason: "unknown-op",
        },
        {
            name: "another story",
            make: world => world.host.receive(
                { kind: "intent", clientId: "x", story: "story-2", op: { op: "rename-story", name: "Rain" } },
                "guest-1",
            ),
            reason: "not-in-session",
        },
        {
            name: "a scene that is gone",
            make: world => world.host.receive(intent({ op: "rename-scene", sceneId: "s9", name: "Nowhere" }), "guest-1"),
            reason: "scene-gone",
        },
    ];

    for (const { name, make, reason } of cases) {
        it(`refuses ${name} with ${reason}, without throwing`, () => {
            const world = makeWorld();
            expect(asRefusal(make(world)).reason).toBe(reason);
            expect(world.applied).toHaveLength(0);
        });
    }

    it("refuses an instance that is not in the session", () => {
        const world = makeWorld({ members: ["guest-1"] });
        expect(asRefusal(send(world, { op: "rename-story", name: "Rain" }, "stranger")).reason).toBe("not-in-session");
        expect(asEffect(send(world, { op: "rename-story", name: "Rain" }, "guest-1")).seq).toBe(1);
    });
});

describe("the claim check", () => {
    it("is permissive when nobody hands one in", () => {
        const world = makeWorld();
        expect(asEffect(send(world, { op: "set-block-disabled", sceneId: "s1", blockId: "b", disabled: true })).seq).toBe(1);
    });

    it("refuses a claimed row and names who holds it", () => {
        const world = makeWorld({ claims: { b: "guest-2" } });
        const refusal = asRefusal(send(world, { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload }, "guest-1"));

        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("guest-2");
        expect(world.applied).toHaveLength(0);
    });

    it("lets the holder write its own row", () => {
        const world = makeWorld({ claims: { b: "guest-2" } });
        expect(asEffect(send(world, { op: "update-block", sceneId: "s1", blockId: "b", payload: note("b", "mine").payload }, "guest-2")).seq).toBe(1);
    });

    it("is not consulted for the operations a claim does not govern", () => {
        const world = makeWorld({ claims: { b: "guest-2" } });
        expect(asEffect(send(world, { op: "move-block", sceneId: "s1", blockId: "b", target: { parentId: null, beforeBlockId: "a" } }, "guest-1")).seq).toBe(1);
    });
});

describe("catching a guest up", () => {
    it("answers a resync with everything after the sequence it names, addressed to who asked", () => {
        const world = makeWorld();
        send(world, { op: "rename-story", name: "Rain" });
        send(world, { op: "rename-story", name: "Snow" });
        send(world, { op: "rename-story", name: "Hail" });

        const catchUp = world.host.receive({ kind: "resync", by: "guest-3", after: 1 }, "guest-3");

        expect(catchUp?.kind).toBe("catch-up");
        expect(catchUp?.kind === "catch-up" && catchUp.to).toBe("guest-3");
        expect(catchUp?.kind === "catch-up" && catchUp.effects.map(effect => effect.seq)).toEqual([2, 3]);
    });

    it("says nothing about the messages the host itself produces", () => {
        const world = makeWorld();
        const own: LiveMessage[] = [
            { kind: "effect", by: "host", seq: 1, op: { op: "rename-story", name: "Rain" } },
            { kind: "refusal", clientId: "x", reason: "row-gone" },
            { kind: "claims", seq: 1, held: {} },
            { kind: "catch-up", to: "guest-1", effects: [] },
        ];

        for (const message of own) {
            expect(world.host.receive(message, "host")).toBeNull();
        }
        expect(world.applied).toHaveLength(0);
    });
});

describe("the host's own edits", () => {
    it("go through the same door, take the same numbers and reach the log", () => {
        const world = makeWorld();
        const effect = world.host.applyLocal({ op: "rename-scene", sceneId: "s1", name: "Corridor" }) as LiveEffect;

        expect(effect.kind).toBe("effect");
        expect(effect.by).toBe("host");
        expect(effect.clientId).toBeUndefined();
        expect(world.scenes.s1.name).toBe("Corridor");
        expect(world.host.log.after(0)).toEqual([effect]);
    });

    it("leave the position of a row the host deleted behind, so a guest can still aim at it", () => {
        const world = makeWorld();
        world.host.applyLocal({ op: "delete-block", sceneId: "s1", blockId: "b" });

        const effect = asEffect(send(world, {
            op: "insert-block",
            sceneId: "s1",
            block: note("new"),
            target: { parentId: null, beforeBlockId: "b" },
        }));

        expect(effect.op.op === "insert-block" && effect.op.target).toEqual({ parentId: null, beforeBlockId: "c" });
        expect(order(world.scenes.s1)).toEqual(["a", "new", "c"]);
    });
});
