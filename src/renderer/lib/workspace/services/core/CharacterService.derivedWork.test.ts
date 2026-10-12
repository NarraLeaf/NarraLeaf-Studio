import { describe, expect, it, vi } from "vitest";
import { CharacterService } from "./CharacterService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * Work derived from the cast - the dialog avatar bake - is still owed when a flush comes, and a flush
 * is what Dev Mode, Preview and a closing window read the project after. It has to land first, or a
 * launch straight after adding a pose plays her line with no avatar.
 */
function serviceRecordingWrites() {
    const service = new CharacterService();
    const order: string[] = [];
    vi.spyOn(service as unknown as { flush(): Promise<void> }, "flush").mockImplementation(async () => {
        order.push("write");
    });
    return { service, order };
}

describe("CharacterService.flushPendingChanges with derived work", () => {
    it("runs the owed work before it writes the cast", async () => {
        const { service, order } = serviceRecordingWrites();
        service.registerPendingDerivedWork(async () => {
            await Promise.resolve();
            order.push("bake");
        });

        await service.flushPendingChanges();

        expect(order).toEqual(["bake", "write"]);
    });

    it("still writes the cast when the derived work fails", async () => {
        const { service, order } = serviceRecordingWrites();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        service.registerPendingDerivedWork(async () => {
            throw new Error("decode failed");
        });

        await service.flushPendingChanges();

        expect(order).toEqual(["write"]);
        warn.mockRestore();
    });

    it("stops asking once the work is deregistered", async () => {
        const { service, order } = serviceRecordingWrites();
        const run = vi.fn(async () => {
            order.push("bake");
        });
        const unregister = service.registerPendingDerivedWork(run);
        unregister();

        await service.flushPendingChanges();

        expect(run).not.toHaveBeenCalled();
        expect(order).toEqual(["write"]);
    });
});
