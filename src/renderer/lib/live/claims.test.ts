import { beforeEach, describe, expect, it } from "vitest";
import { storyRowClaimKey, type LiveIntent, type LiveOp, type LiveRefusal } from "@shared/live/ops";
import type { StoryBlock, StoryBlockId, StoryNoteBlock, StoryScene } from "@shared/types/story";
import { DEFAULT_CLAIM_TIMEOUT_MS, LiveClaimStore } from "./claims";
import { LiveHost } from "./liveHost";

/** A clock the tests move by hand, because a test that waits for real seconds is a test nobody runs. */
let clock = 0;

beforeEach(() => {
    clock = 0;
});

/** A store on the hand-moved clock, with a timeout short enough to write in a test. */
function makeStore(timeoutMs: number = 1000): LiveClaimStore {
    return new LiveClaimStore({ now: () => clock, timeoutMs });
}

describe("the claim store", () => {
    it("lets the instance that took a row keep writing it", () => {
        const claims = makeStore();
        expect(claims.claim("row-1", { instance: "i-1", account: "Aoi" })).toEqual({ ok: true, changed: true });

        // The point of a claim is that its holder can go on typing; getting in their own way would
        // make the mechanism the thing it exists to prevent.
        expect(claims.blocking("row-1", "i-1")).toBeNull();
        expect(claims.holder("row-1")).toEqual({ instance: "i-1", account: "Aoi" });
    });

    it("refuses a row somebody else is writing, and names the person", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        // An account name rather than an instance id: a refusal is read by a person, and an id says
        // nothing to one.
        expect(claims.claim("row-1", { instance: "i-2", account: "Ren" })).toEqual({ ok: false, heldBy: "Aoi" });
        expect(claims.blocking("row-1", "i-2")).toBe("Aoi");
        expect(claims.holder("row-1")).toEqual({ instance: "i-1", account: "Aoi" });
    });

    it("treats a second assertion by the holder as a success, not a refusal", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        // Every keystroke in the box asserts the claim again. A refusal here would be Studio telling
        // an author they may not write their own line.
        expect(claims.claim("row-1", { instance: "i-1", account: "Aoi" })).toEqual({ ok: true, changed: false });
        expect(claims.size).toBe(1);
    });

    it("leaves an untouched row free", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        expect(claims.blocking("row-2", "i-2")).toBeNull();
        expect(claims.holder("row-2")).toBeNull();
    });

    it("lets go of a row when its holder releases it", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        expect(claims.release("row-1", "i-1")).toBe(true);
        expect(claims.blocking("row-1", "i-2")).toBeNull();
        expect(claims.release("row-1", "i-1")).toBe(false);
    });

    it("ignores a release from anybody but the holder", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        // Otherwise a stale release arriving late would take a row off the person writing it, and do
        // it without ever being refused.
        expect(claims.release("row-1", "i-2")).toBe(false);
        expect(claims.blocking("row-1", "i-2")).toBe("Aoi");
    });

    it("lets go of everything an instance held when it goes", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });
        claims.claim("row-2", { instance: "i-1", account: "Aoi" });
        claims.claim("row-3", { instance: "i-2", account: "Ren" });

        // Leaving the session and a dead socket are the same event from here.
        expect(claims.releaseAll("i-1")).toBe(true);
        expect(claims.snapshot().held).toEqual({ "row-3": "Ren" });
        expect(claims.releaseAll("i-1")).toBe(false);
    });

    it("lets a claim lapse once its holder has gone quiet", () => {
        const claims = makeStore(1000);
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        clock = 999;
        expect(claims.blocking("row-1", "i-2")).toBe("Aoi");

        clock = 1000;
        expect(claims.blocking("row-1", "i-2")).toBeNull();
        // The row is writable again, which is the whole point of the lapse: a machine that died
        // holding a line must not hold it for the rest of the session.
        expect(claims.claim("row-1", { instance: "i-2", account: "Ren" })).toEqual({ ok: true, changed: true });
    });

    it("keeps a claim while its holder is still typing", () => {
        const claims = makeStore(1000);
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        // The deadline is measured from the last assertion, not from the first, so the timeout has
        // to outlast a pause between keystrokes rather than a whole paragraph.
        clock = 900;
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });
        clock = 1800;

        expect(claims.blocking("row-1", "i-2")).toBe("Aoi");
    });

    it("lapses on the default timeout when none was chosen", () => {
        const claims = new LiveClaimStore({ now: () => clock });
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        clock = DEFAULT_CLAIM_TIMEOUT_MS - 1;
        expect(claims.size).toBe(1);

        clock = DEFAULT_CLAIM_TIMEOUT_MS;
        expect(claims.size).toBe(0);
    });

    it("reports a lapse when it is swept, so a caller knows to broadcast", () => {
        const claims = makeStore(1000);
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        expect(claims.sweep()).toBe(false);
        clock = 1000;
        expect(claims.sweep()).toBe(true);
        expect(claims.sweep()).toBe(false);
    });

    it("forgets the claim on a row that has been deleted", () => {
        const claims = makeStore();
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });

        expect(claims.forget("row-1")).toBe(true);
        expect(claims.snapshot().held).toEqual({});
        expect(claims.forget("row-1")).toBe(false);
    });

    it("snapshots exactly the rows being written, and follows every way the set changes", () => {
        const claims = makeStore(1000);
        expect(claims.snapshot()).toEqual({ kind: "claims", seq: 0, held: {} });

        claims.claim("row-1", { instance: "i-1", account: "Aoi" });
        claims.claim("row-2", { instance: "i-2", account: "Ren" });
        const both = claims.snapshot();
        expect(both.held).toEqual({ "row-1": "Aoi", "row-2": "Ren" });

        claims.release("row-1", "i-1");
        const afterRelease = claims.snapshot();
        expect(afterRelease.held).toEqual({ "row-2": "Ren" });
        expect(afterRelease.seq).toBeGreaterThan(both.seq);

        clock = 1000;
        const afterLapse = claims.snapshot();
        expect(afterLapse.held).toEqual({});
        expect(afterLapse.seq).toBeGreaterThan(afterRelease.seq);
    });

    it("advances its revision only when the set changes", () => {
        const claims = makeStore();
        const empty = claims.revision;

        claims.claim("row-1", { instance: "i-1", account: "Aoi" });
        const claimed = claims.revision;
        expect(claimed).toBeGreaterThan(empty);

        // A renewal and a refused claim both leave the set as it was, so a caller comparing
        // revisions broadcasts neither.
        claims.claim("row-1", { instance: "i-1", account: "Aoi" });
        claims.claim("row-1", { instance: "i-2", account: "Ren" });
        expect(claims.revision).toBe(claimed);
    });
});

/* ------------------------------------------------------- the store answering for a host */

const STORY = "story-1";

function note(id: StoryBlockId): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value: id, role: "note" } },
    };
}

/** A scene of loose rows, which is as much document as a claim decision ever looks at. */
function makeScene(ids: StoryBlockId[]): StoryScene {
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    for (const id of ids) {
        blocks[id] = note(id);
    }
    return { id: "s1", name: "Scene s1", runtimeName: "s1", rootBlockIds: [...ids], blocks };
}

function makeHost(claims?: LiveClaimStore): { host: LiveHost; scene: StoryScene } {
    const scene = makeScene(["row-1", "row-2"]);
    let seq = 0;
    const host = new LiveHost({
        self: "host",
        stories: [STORY],
        readScene: (_storyId, id) => (id === scene.id ? scene : null),
        readCharacter: () => null,
        hasAsset: () => false,
        readAssetFolders: () => null,
        hasAppTag: () => false,
        hasDlc: () => false,
        hasBrandColor: () => false,
        digestOf: () => null,
        applyOp: op => {
            if (op.op === "delete-block") {
                delete scene.blocks[op.blockId];
                scene.rootBlockIds = scene.rootBlockIds.filter(id => id !== op.blockId);
            }
        },
        nextSeq: () => ++seq,
        claims,
    });
    return { host, scene };
}

function intent(clientId: string, op: LiveOp): LiveIntent {
    return { kind: "intent", clientId, document: { doc: "story", storyId: STORY }, op };
}

/** An edit of one row. Its payload is beside the point here - what is under test is who may send it. */
function update(blockId: StoryBlockId): LiveOp {
    return { op: "update-block", sceneId: "s1", blockId, payload: note(blockId).payload };
}

describe("a host answering from its claim store", () => {
    it("refuses a claimed row to anybody but its holder, and names the account", () => {
        const claims = makeStore();
        const { host } = makeHost(claims);
        claims.claim(storyRowClaimKey("row-1"), { instance: "guest-1", account: "Aoi" });

        const refusal = host.receive(intent("c1", update("row-1")), "guest-2") as LiveRefusal;
        expect(refusal.kind).toBe("refusal");
        expect(refusal.reason).toBe("row-claimed");
        expect(refusal.heldBy).toBe("Aoi");
    });

    it("lets the holder write the row it claimed", () => {
        const claims = makeStore();
        const { host } = makeHost(claims);
        claims.claim(storyRowClaimKey("row-1"), { instance: "guest-1", account: "Aoi" });

        expect(host.receive(intent("c1", update("row-1")), "guest-1")?.kind).toBe("effect");
    });

    it("says yes to everything while nothing is claimed", () => {
        const { host } = makeHost(makeStore());

        expect(host.receive(intent("c1", update("row-1")), "guest-2")?.kind).toBe("effect");
    });

    it("drops the claim on a row it deletes, because nobody is writing a row that is gone", () => {
        const claims = makeStore();
        const { host } = makeHost(claims);
        claims.claim(storyRowClaimKey("row-1"), { instance: "guest-1", account: "Aoi" });

        host.receive(intent("c1", { op: "delete-block", sceneId: "s1", blockId: "row-1" }), "guest-1");

        expect(claims.snapshot().held).toEqual({});
    });

    it("builds its own store when none is given", () => {
        const { host } = makeHost();

        // The record is the host's own memory; a caller that has no use for it still gets a host
        // that can hold one.
        expect(host.claims.snapshot()).toEqual({ kind: "claims", seq: 0, held: {} });
    });
});
