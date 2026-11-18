import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { LiveSessionService } from "./LiveSessionService";
import type { LiveSessionDeps } from "./liveSessionPorts";

function checkpointHarness(flush: () => Promise<void>) {
    const order: string[] = [];
    const createCheckpoint = vi.fn(async () => {
        order.push("checkpoint");
        return { revision: "saved-revision" };
    });
    const context = {
        services: {
            get(id: Services) {
                if (id === Services.SaveStatus) return {
                    settlePendingEdits: () => { order.push("settle"); },
                    listSavers: () => [{
                        labelKey: "workspace.shell.save.stores.characters",
                        saver: { flush: async () => { order.push("flush"); await flush(); } },
                    }],
                };
                if (id === Services.VersionControl) return { createCheckpoint };
                if (id === Services.Console) return { log: () => {} };
                throw new Error(`no ${id}`);
            },
        },
    } as unknown as WorkspaceContext;
    const service = new LiveSessionService();
    const deps = (service as unknown as { buildDeps(context: WorkspaceContext): LiveSessionDeps }).buildDeps(context);
    return { checkpoint: deps.version.checkpoint, order, createCheckpoint };
}

describe("live session checkpoint wiring", () => {
    it("settles and flushes pending edits before recording the revision", async () => {
        const harness = checkpointHarness(async () => {});
        await expect(harness.checkpoint()).resolves.toBe("saved-revision");
        expect(harness.order).toEqual(["settle", "flush", "checkpoint"]);
        expect(harness.createCheckpoint).toHaveBeenCalledWith("live-session");
    });

    it("refuses the checkpoint if a pending save failed", async () => {
        const harness = checkpointHarness(async () => { throw new Error("disk full"); });
        await expect(harness.checkpoint()).rejects.toThrow("Pending changes could not be saved");
        expect(harness.order).toEqual(["settle", "flush"]);
        expect(harness.createCheckpoint).not.toHaveBeenCalled();
    });
});
