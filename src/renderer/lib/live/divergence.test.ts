import { describe, expect, it } from "vitest";
import type { LiveEffect } from "@shared/live/ops";
import { sceneDigest } from "@shared/live/sceneDigest";
import type { StoryScene } from "@shared/types/story";
import { LiveDivergenceGuard, type LiveDivergenceRuling } from "./divergence";
import { LiveGuest } from "./liveGuest";

const OURS = "digest-this-machine-computed";
const THEIRS = "digest-the-host-sent";

function effect(seq: number, extra: Partial<LiveEffect> = {}): LiveEffect {
    return {
        kind: "effect",
        by: "host",
        seq,
        document: { doc: "story", storyId: "story-1" },
        op: { op: "rename-scene", sceneId: "s1", name: `Take ${seq}` },
        ...extra,
    };
}

describe("the divergence guard", () => {
    it("agrees, and goes on agreeing, while the digests match", () => {
        const guard = new LiveDivergenceGuard();

        for (const seq of [1, 2, 3, 4]) {
            expect(guard.check(effect(seq, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: OURS } }), OURS)).toEqual({ verdict: "agreed" });
        }
        expect(guard.divergence).toBeNull();
    });

    it("diverges on one mismatch, and names the unit, the sequence and both digests", () => {
        const guard = new LiveDivergenceGuard();
        guard.check(effect(6, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: OURS } }), OURS);

        const ruling = guard.check(effect(7, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: THEIRS } }), OURS);

        expect(ruling).toEqual({
            verdict: "diverged",
            divergence: { scope: { of: "scene", sceneId: "s1" }, seq: 7, expected: THEIRS, computed: OURS },
        });
        expect(guard.divergence)
            .toEqual({ scope: { of: "scene", sceneId: "s1" }, seq: 7, expected: THEIRS, computed: OURS });
    });

    it("still reports diverged when a later effect agrees", () => {
        // The door does not reopen. A digest computed after the mismatch comes from the document the
        // mismatch condemned, so it can agree about the row just edited while the difference already
        // found sits somewhere the digest never covered.
        const guard = new LiveDivergenceGuard();
        guard.check(effect(3, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: THEIRS } }), OURS);

        const later = guard.check(effect(4, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: OURS } }), OURS);

        expect(later).toEqual({
            verdict: "diverged",
            divergence: { scope: { of: "scene", sceneId: "s1" }, seq: 3, expected: THEIRS, computed: OURS },
        });
        // The first decision, handed back rather than a second one built from the effect that agreed.
        expect(guard.divergence?.seq).toBe(3);
    });

    it("is not moved either way by an effect that carries no digest", () => {
        const guard = new LiveDivergenceGuard();

        // The very first thing it sees, so nothing can be standing in for the answer.
        expect(guard.check(effect(1), OURS)).toEqual({ verdict: "unproven" });
        expect(guard.divergence).toBeNull();

        // And it has latched nothing: the next effect that does disagree is still free to say so.
        expect(guard.check(effect(2, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: THEIRS } }), OURS)).toMatchObject({ verdict: "diverged" });
    });

    it("does not call a scene it could not read a divergence", () => {
        const guard = new LiveDivergenceGuard();

        expect(guard.check(effect(1, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: THEIRS } }), null)).toEqual({ verdict: "unproven" });
        expect(guard.divergence).toBeNull();
    });
});

/* ------------------------------------------------------- the guard behind a running guest */

type GuestWorld = {
    guest: LiveGuest;
    guard: LiveDivergenceGuard;
    scene: StoryScene;
    /** Every ruling the seam produced, in order. */
    rulings: LiveDivergenceRuling[];
};

/**
 * A guest applying effects to a scene of its own, with its digest seam pointed at a guard.
 *
 * The wiring is the whole subject: the guest reports what it computed and the guard rules on it, and
 * neither half is asked to do the other's job.
 */
function makeGuestWorld(): GuestWorld {
    const scene: StoryScene = { id: "s1", name: "Scene", runtimeName: "s1", rootBlockIds: [], blocks: {} };
    const guard = new LiveDivergenceGuard();
    const rulings: LiveDivergenceRuling[] = [];

    const guest = new LiveGuest({
        self: "guest-1",
        applyOp: op => {
            if (op.op === "rename-scene") {
                scene.name = op.name;
            }
        },
        send: () => undefined,
        now: () => 0,
        schedule: () => () => undefined,
        digestOf: scope => (scope.of === "scene" && scope.sceneId === scene.id ? sceneDigest(scene) : null),
        onDigest: (arrived, digest) => rulings.push(guard.check(arrived, digest)),
    });
    return { guest, guard, scene, rulings };
}

describe("a guest whose seam runs into the guard", () => {
    it("leaves the guard diverged when what arrives disagrees with what it applied", () => {
        const world = makeGuestWorld();

        world.guest.receive(effect(1, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: THEIRS } }));

        expect(world.scene.name).toBe("Take 1");
        expect(world.guard.divergence).toEqual({
            scope: { of: "scene", sceneId: "s1" },
            seq: 1,
            expected: THEIRS,
            computed: sceneDigest(world.scene),
        });
    });

    it("leaves it agreeing when the host made the same thing of the scene", () => {
        const world = makeGuestWorld();
        const renamed: StoryScene = { ...world.scene, name: "Take 1" };

        world.guest.receive(effect(1, { digest: { scope: { of: "scene", sceneId: "s1" }, hash: sceneDigest(renamed) } }));

        expect(world.rulings).toEqual([{ verdict: "agreed" }]);
        expect(world.guard.divergence).toBeNull();
    });
});
