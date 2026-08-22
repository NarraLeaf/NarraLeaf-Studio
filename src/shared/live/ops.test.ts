import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { CLAIMED_OPS, isLiveMessage, opBlockId, opSceneId, type LiveOp } from "./ops";
import { sceneDigest } from "./sceneDigest";

const BLOCK: StoryBlock = {
    id: "block-1",
    payload: { kind: "dialogue", speaker: { kind: "temp", name: "Aoi" }, text: "You're late." },
} as unknown as StoryBlock;

/** One of each operation, so the helpers below are exercised over the whole vocabulary. */
const EVERY_OP: LiveOp[] = [
    { op: "insert-block", sceneId: "s1", block: BLOCK, target: { parentId: null } },
    { op: "update-block", sceneId: "s1", blockId: "block-1", payload: BLOCK.payload },
    { op: "delete-block", sceneId: "s1", blockId: "block-1" },
    { op: "move-block", sceneId: "s1", blockId: "block-1", target: { parentId: null, beforeBlockId: "block-2" } },
    { op: "set-block-disabled", sceneId: "s1", blockId: "block-1", disabled: true },
    { op: "rename-scene", sceneId: "s1", name: "Corridor" },
    { op: "set-entry-scene", sceneId: "s1" },
    { op: "rename-story", name: "Skeleton" },
    { op: "reorder-chapters", chapterIds: ["c2", "c1"] },
];

describe("the operation vocabulary", () => {
    it("answers a block for every operation that is about one, and null for the rest", () => {
        // Both helpers are exhaustive switches with no default: an operation added later fails to
        // compile here until somebody has said what it is about, which is what stops a new verb
        // silently escaping the claim rules below.
        const byOp = new Map(EVERY_OP.map(op => [op.op, opBlockId(op)]));
        expect(byOp.get("insert-block")).toBe("block-1");
        expect(byOp.get("update-block")).toBe("block-1");
        expect(byOp.get("delete-block")).toBe("block-1");
        expect(byOp.get("move-block")).toBe("block-1");
        expect(byOp.get("set-block-disabled")).toBe("block-1");
        expect(byOp.get("rename-scene")).toBeNull();
        expect(byOp.get("set-entry-scene")).toBeNull();
        expect(byOp.get("rename-story")).toBeNull();
        expect(byOp.get("reorder-chapters")).toBeNull();
    });

    it("answers a scene for the operations that live inside one", () => {
        const byOp = new Map(EVERY_OP.map(op => [op.op, opSceneId(op)]));
        for (const kind of ["insert-block", "update-block", "delete-block", "move-block", "set-block-disabled", "rename-scene"] as const) {
            expect(byOp.get(kind)).toBe("s1");
        }
        expect(byOp.get("rename-story")).toBeNull();
        expect(byOp.get("reorder-chapters")).toBeNull();
    });

    it("claims only the operations that would destroy a paragraph somebody is typing", () => {
        // The line between the two is what a loser loses. Editing, deleting or disabling a row while
        // its author is mid-paragraph takes the paragraph; renaming a scene under somebody takes a
        // word. The first is worth the ceremony of a claim and the second is not.
        expect([...CLAIMED_OPS].sort()).toEqual(["delete-block", "set-block-disabled", "update-block"]);
        for (const kind of ["rename-scene", "set-entry-scene", "rename-story", "reorder-chapters", "move-block", "insert-block"] as const) {
            expect(CLAIMED_OPS.has(kind)).toBe(false);
        }
    });

    it("claims by row rather than by field, so a claimed row is claimed whole", () => {
        // A row's fields hold each other up: a different speaker changes how the prose parses and
        // which translation entry the line belongs to. Two people editing "different fields" of one
        // row are editing one row.
        const text: LiveOp = { op: "update-block", sceneId: "s1", blockId: "block-1", payload: BLOCK.payload };
        const disabled: LiveOp = { op: "set-block-disabled", sceneId: "s1", blockId: "block-1", disabled: true };
        expect(CLAIMED_OPS.has(text.op) && CLAIMED_OPS.has(disabled.op)).toBe(true);
        expect(opBlockId(text)).toBe(opBlockId(disabled));
    });
});

describe("isLiveMessage", () => {
    it("recognises every kind a machine in a session can send", () => {
        const kinds = ["intent", "effect", "refusal", "claims", "resync", "catch-up"];
        for (const kind of kinds) {
            expect(isLiveMessage({ kind })).toBe(true);
        }
    });

    it("rejects anything else, because the payload comes from another build", () => {
        // The channel carries whatever another Studio put on it, which may be a version this one has
        // never seen. Something unreadable has to be ignored rather than handed on.
        for (const value of [null, undefined, 42, "effect", {}, { kind: "nonsense" }, []]) {
            expect(isLiveMessage(value)).toBe(false);
        }
    });
});

describe("sceneDigest", () => {
    const scene = (blocks: Record<string, unknown>): StoryScene =>
        ({ id: "s1", name: "Corridor", blocks, order: Object.keys(blocks) } as unknown as StoryScene);

    it("agrees for two copies of one scene built in different key orders", () => {
        // The comparison has to survive key order or it reports a disagreement nobody can act on:
        // two machines assemble the same scene through different code paths every day.
        const a = { id: "s1", name: "Corridor", blocks: { b1: { id: "b1", text: "one" } } };
        const b = { name: "Corridor", blocks: { b1: { text: "one", id: "b1" } }, id: "s1" };
        expect(sceneDigest(a as unknown as StoryScene)).toBe(sceneDigest(b as unknown as StoryScene));
    });

    it("differs when the content differs, which is the whole point of computing it", () => {
        expect(sceneDigest(scene({ b1: { id: "b1", text: "one" } })))
            .not.toBe(sceneDigest(scene({ b1: { id: "b1", text: "two" } })));
    });

    it("differs when a row is added, so a missed operation cannot hide", () => {
        const before = sceneDigest(scene({ b1: { id: "b1", text: "one" } }));
        const after = sceneDigest(scene({ b1: { id: "b1", text: "one" }, b2: { id: "b2", text: "two" } }));
        expect(after).not.toBe(before);
    });

    it("is short enough to ride on every effect", () => {
        // It travels with each operation down a channel with a payload cap, so its size is part of
        // the contract rather than an implementation detail.
        expect(sceneDigest(scene({ b1: { id: "b1" } }))).toMatch(/^[0-9a-f]{16}$/);
    });
});
