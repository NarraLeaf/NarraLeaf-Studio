import { describe, expect, it, vi } from "vitest";
import { AssetsService } from "./AssetsService";
import { AssetType } from "../assets/assetTypes";
import { Services } from "../services";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The metadata shard is written by whichever flush asks first, and a bulk import asks constantly:
 * one transaction per batch, with `markDirty` outside any transaction firing a flush it does not
 * wait for. Two flushes writing one shard at once lost the library twice over - the older write's
 * rename could land last, and the newer one could be refused by the no-follow gate, which saw the
 * inode the other rename had just unlinked. These tests pin that the shard has one writer at a time
 * and that the last bytes to land are the newest.
 */

type PendingWrite = { path: string; data: string; finish: () => void };

function createHarness() {
    const pending: PendingWrite[] = [];
    const landed: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const images: Record<string, unknown> = {};
    const metadataManager = {
        getAssets: () => ({ [AssetType.Image]: images }),
        getUnreadableShards: () => new Map(),
    };

    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) => parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/"),
        },
        services: {
            get(serviceId: Services) {
                if (serviceId === Services.FileSystem) {
                    return {
                        writeFileNoFollow: (path: string, data: string) => {
                            inFlight += 1;
                            maxInFlight = Math.max(maxInFlight, inFlight);
                            return new Promise(resolve => {
                                pending.push({
                                    path,
                                    data,
                                    finish: () => {
                                        inFlight -= 1;
                                        landed.push(data);
                                        resolve({ ok: true, data: undefined });
                                    },
                                });
                            });
                        },
                    };
                }
                throw new Error(`Unexpected service ${serviceId}`);
            },
        },
    };

    const service = new AssetsService();
    service.setContext(context as any);
    (service as any).assetsMetadataManager = metadataManager;

    /** Let every queued continuation run, so a flush that is going to start has started. */
    const settle = async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    };

    return {
        service,
        images,
        pending,
        landed,
        settle,
        get maxInFlight() {
            return maxInFlight;
        },
    };
}

describe("AssetsService shard flushes", () => {
    it("never has two writes of one shard in flight, and lands the newest library last", async () => {
        const harness = createHarness();

        harness.images.a = { id: "a" };
        harness.service.markDirty(AssetType.Image);
        await harness.settle();
        expect(harness.pending).toHaveLength(1);

        // Two more changes while the first write is still on its way to disk.
        harness.images.b = { id: "b" };
        harness.service.markDirty(AssetType.Image);
        harness.images.c = { id: "c" };
        harness.service.markDirty(AssetType.Image);
        await harness.settle();
        expect(harness.pending).toHaveLength(1);

        harness.pending[0].finish();
        await harness.settle();
        // Both later changes share one follow-up write, which carries everything.
        expect(harness.pending).toHaveLength(2);
        harness.pending[1].finish();
        await harness.settle();

        expect(harness.maxInFlight).toBe(1);
        expect(harness.landed).toHaveLength(2);
        expect(JSON.parse(harness.landed.at(-1)!)).toEqual({ a: { id: "a" }, b: { id: "b" }, c: { id: "c" } });
    });

    it("finishes a transaction only once its own change is on disk", async () => {
        const harness = createHarness();

        harness.images.a = { id: "a" };
        harness.service.markDirty(AssetType.Image);
        await harness.settle();

        let committed = false;
        const transaction = harness.service.transaction(() => {
            harness.images.b = { id: "b" };
            harness.service.markDirty(AssetType.Image);
        }).then(() => {
            committed = true;
        });

        await harness.settle();
        harness.pending[0].finish();
        await harness.settle();
        // The first write has landed, but it was taken before `b` existed.
        expect(committed).toBe(false);
        expect(harness.pending).toHaveLength(2);

        harness.pending[1].finish();
        await transaction;
        expect(committed).toBe(true);
        expect(JSON.parse(harness.landed.at(-1)!)).toEqual({ a: { id: "a" }, b: { id: "b" } });
    });
});
