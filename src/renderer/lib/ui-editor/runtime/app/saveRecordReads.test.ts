/**
 * A save screen reads each record once, however many of its nodes ask.
 *
 * The store is a stand-in that counts what it is asked; the clock is a number the test moves. What
 * is pinned is how many times the store is reached, and that nothing stale outlives a write.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import type { GameAppSaveHeader, GameAppSaveRecord } from "./GameAppHost";
import { SAVE_RECORD_REUSE_MS, SaveRecordReads } from "./saveRecordReads";

function harness() {
    const clock = { now: 1000 };
    const calls = { read: [] as string[], readPreview: [] as string[], listHeaders: 0 };
    const records = new Map<string, GameAppSaveRecord>([
        ["1", { savedGame: { n: 1 }, metadata: { capture: "data:image/jpeg;base64,ONE", playtimeSeconds: 60 } }],
        ["2", { savedGame: { n: 2 }, metadata: {} }],
    ]);
    let failNextRead = false;
    const store = {
        read: async (id: string) => {
            calls.read.push(id);
            if (failNextRead) {
                failNextRead = false;
                throw new Error("disk is on fire");
            }
            return records.get(id) ?? null;
        },
        readPreview: async (id: string) => {
            calls.readPreview.push(id);
            return records.get(id)?.metadata.capture ?? null;
        },
        listHeaders: async (): Promise<GameAppSaveHeader[]> => {
            calls.listHeaders += 1;
            return [...records.keys()].map(id => ({ id }));
        },
    };
    const reads = new SaveRecordReads(store, () => clock.now);
    return { reads, calls, clock, records, failNext: () => { failNextRead = true; } };
}

describe("SaveRecordReads", () => {
    it("reads a slot once for every field a screen asks about, the picture included", async () => {
        const { reads, calls } = harness();

        // What the starter's slot does: metadata, the line twice, times, playtime - then the picture.
        const fields = await Promise.all([reads.read("1"), reads.read("1"), reads.read("1"), reads.read("1"), reads.read("1")]);
        const picture = await reads.readPreview("1");

        expect(new Set(fields).size).toBe(1);
        expect(picture).toBe("data:image/jpeg;base64,ONE");
        expect(calls.read).toEqual(["1"]);
        expect(calls.readPreview).toEqual([]);
    });

    it("lists the headers once for every slot on the screen", async () => {
        const { reads, calls } = harness();

        await Promise.all(Array.from({ length: 9 }, () => reads.listHeaders()));

        expect(calls.listHeaders).toBe(1);
    });

    it("reads the store again once the screen's moment has passed", async () => {
        const { reads, calls, clock } = harness();
        await reads.read("1");
        await reads.listHeaders();

        clock.now += SAVE_RECORD_REUSE_MS;
        await reads.read("1");
        await reads.listHeaders();

        expect(calls.read).toEqual(["1", "1"]);
        expect(calls.listHeaders).toBe(2);
    });

    it("drops a slot and the listing when the slot is written or removed", async () => {
        const { reads, calls, records } = harness();
        expect((await reads.read("1"))?.metadata.playtimeSeconds).toBe(60);
        await reads.listHeaders();

        records.set("1", { savedGame: { n: 3 }, metadata: { playtimeSeconds: 90 } });
        reads.forget("1");

        expect((await reads.read("1"))?.metadata.playtimeSeconds).toBe(90);
        await reads.listHeaders();
        expect(calls.read).toEqual(["1", "1"]);
        expect(calls.listHeaders).toBe(2);
        // Another slot's record is still the one held.
        await reads.read("2");
        await reads.read("2");
        expect(calls.read).toEqual(["1", "1", "2"]);
    });

    it("asks the store for a picture when no record is held", async () => {
        const { reads, calls } = harness();

        expect(await reads.readPreview("1")).toBe("data:image/jpeg;base64,ONE");
        expect(calls.readPreview).toEqual(["1"]);
        expect(calls.read).toEqual([]);
    });

    it("keeps no failed read", async () => {
        const { reads, calls, failNext } = harness();
        failNext();

        await expect(reads.read("1")).rejects.toThrow("disk is on fire");
        expect((await reads.read("1"))?.metadata.playtimeSeconds).toBe(60);
        expect(calls.read).toEqual(["1", "1"]);
    });
});
