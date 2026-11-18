import { describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { SaveStatusService } from "../autosave/SaveStatusService";
import { createTeamFilePorts } from "./teamFilePorts";

function portsWithSave(flush: () => Promise<void>) {
    const order: string[] = [];
    const ctx = {
        project: { getConfig: () => ({ projectPath: "/project" }) },
        services: { get: (id: Services) => {
            if (id === Services.SaveStatus) return {
                settlePendingEdits: () => { order.push("settle"); },
                listSavers: () => [{
                    labelKey: "workspace.shell.save.stores.characters",
                    saver: { flush: async () => { order.push("flush"); await flush(); } },
                }],
                flushAll: async () => { order.push("legacy flush"); await flush().catch(() => undefined); },
            };
            if (id === Services.Console) return { log: () => undefined };
            throw new Error(`No service ${id}`);
        } },
    } as unknown as WorkspaceContext;
    return { ports: createTeamFilePorts(ctx, { remoteOrigin: "local", project: "project" }), order };
}

describe("Team file save barrier", () => {
    it("settles open editors before waiting for their saves", async () => {
        const { ports, order } = portsWithSave(async () => undefined);
        await ports.flush();
        expect(order).toEqual(["settle", "flush"]);
    });

    it("refuses to proceed when a pending save failed", async () => {
        const { ports, order } = portsWithSave(async () => { throw new Error("disk full"); });
        await expect(ports.flush()).rejects.toThrow();
        expect(order).toEqual(["settle", "flush"]);
    });

    it("refuses to proceed when an open editor cannot settle its draft", async () => {
        const status = new SaveStatusService();
        const otherEditor = vi.fn();
        status.registerPendingEdit(() => { throw new Error("editor could not commit"); });
        status.registerPendingEdit(otherEditor);
        const ctx = {
            project: { getConfig: () => ({ projectPath: "/project" }) },
            services: { get: (id: Services) => {
                if (id === Services.SaveStatus) return status;
                if (id === Services.Console) return { log: () => undefined };
                throw new Error(`No service ${id}`);
            } },
        } as unknown as WorkspaceContext;

        await expect(createTeamFilePorts(ctx, { remoteOrigin: "local", project: "project" }).flush()).rejects.toThrow();
        expect(otherEditor).toHaveBeenCalledOnce();
    });
});
