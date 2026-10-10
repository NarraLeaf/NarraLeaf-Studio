import { describe, expect, it, vi } from "vitest";
import { Services } from "../services";
import { flushPendingSaves } from "./flushPendingSaves";

/**
 * The shutdown flush reaches the asset library too.
 *
 * The library has no debounced saver to register: it writes as it changes, and what it can still
 * owe is a write the disk refused, retried by the next change - which a closing window never makes.
 */
function contextWith(services: Partial<Record<Services, unknown>>) {
    return {
        services: {
            get(id: Services) {
                if (id in services) {
                    return services[id];
                }
                throw new Error(`no ${id}`);
            },
        },
    } as never;
}

describe("flushPendingSaves", () => {
    it("asks the asset library to write what it still owes", async () => {
        const flushOwedWrites = vi.fn(async () => undefined);
        const result = await flushPendingSaves(contextWith({ [Services.Assets]: { flushOwedWrites } }));
        expect(flushOwedWrites).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ flushed: true, failures: [] });
    });

    it("names the asset library when its owed write is still refused", async () => {
        const log = vi.fn();
        const result = await flushPendingSaves(contextWith({
            [Services.Assets]: { flushOwedWrites: async () => { throw new Error("asset library sections not written: image"); } },
            [Services.Console]: { log },
        }));
        expect(result.flushed).toBe(false);
        expect(result.failures).toHaveLength(1);
        expect(log).toHaveBeenCalledTimes(1);
    });
});
