import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { PanelStateService } from "./PanelStateService";
import { RecentColorsService } from "./RecentColorsService";

function deferredWrite() {
    let resolve!: (value: { ok: true; data: { path: string } }) => void;
    const promise = new Promise<{ ok: true; data: { path: string } }>(done => { resolve = done; });
    return { promise, resolve: () => resolve({ ok: true, data: { path: "store" } }) };
}

function contextWith(writeStore: (...args: any[]) => Promise<unknown>): WorkspaceContext {
    const store = { readStore: async () => ({ ok: false }), writeStore };
    return {
        project: {} as WorkspaceContext["project"],
        services: {
            get: (service: Services) => service === Services.ServiceAssets ? store : {},
        } as never,
        commandLineRun: false,
    };
}

describe("workspace state service persistence", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    for (const kind of ["panel", "colors"] as const) {
        it(`waits for an existing ${kind} write when no later edit is pending`, async () => {
            const write = deferredWrite();
            const writeStore = vi.fn(() => write.promise);
            const ctx = contextWith(writeStore);
            const service = kind === "panel" ? new PanelStateService() : new RecentColorsService();
            await service.initialize(ctx, async () => undefined);
            if (service instanceof PanelStateService) service.setPanelState("panel", { open: true });
            else service.addColor("#111111");
            await vi.advanceTimersByTimeAsync(300);

            let closed = false;
            const closing = service.teardown(ctx).then(() => { closed = true; });
            await vi.advanceTimersByTimeAsync(0);
            const closedBeforeWrite = closed;
            write.resolve();
            await closing;

            expect(writeStore).toHaveBeenCalledTimes(1);
            expect(closedBeforeWrite).toBe(false);
        });

        it(`waits for and serialises ${kind} writes when the workspace closes`, async () => {
            const writes: Array<{ data: any; finish: () => void }> = [];
            const writeStore = vi.fn((_namespace: string, data: unknown) => {
                const write = deferredWrite();
                writes.push({ data: JSON.parse(JSON.stringify(data)), finish: write.resolve });
                return write.promise;
            });
            const ctx = contextWith(writeStore);
            const service = kind === "panel" ? new PanelStateService() : new RecentColorsService();
            const edit = (index: number) => {
                if (service instanceof PanelStateService) service.setPanelState("panel", { index });
                else service.addColor(index === 1 ? "#111111" : "#222222");
            };

            await service.initialize(ctx, async () => undefined);
            edit(1);
            await vi.advanceTimersByTimeAsync(300);
            edit(2);
            let closed = false;
            const closing = service.teardown(ctx).then(() => { closed = true; });
            await vi.advanceTimersByTimeAsync(0);
            const writesBeforeFirstCompletes = writes.length;
            const closedBeforeFirstCompletes = closed;
            writes[0].finish();
            await vi.advanceTimersByTimeAsync(0);
            const writesAfterFirstCompletes = writes.length;
            writes[1]?.finish();
            await closing;

            expect(closedBeforeFirstCompletes).toBe(false);
            expect(writesBeforeFirstCompletes).toBe(1);
            expect(writesAfterFirstCompletes).toBe(2);
            if (kind === "panel") {
                expect(writes.map(write => write.data.panels.panel.index)).toEqual([1, 2]);
            } else {
                expect(writes.map(write => write.data.colors)).toEqual([["#111111"], ["#222222", "#111111"]]);
            }
        });
    }

    it("starts an empty panel store for a project with no saved panel state", async () => {
        const ctx1 = contextWith(async () => ({ ok: true, data: { path: "first" } }));
        const ctx2 = contextWith(async () => ({ ok: true, data: { path: "second" } }));
        const service = new PanelStateService();
        await service.initialize(ctx1, async () => undefined);
        service.setPanelState("first-project-panel", { open: true });
        await service.teardown(ctx1);

        await service.initialize(ctx2, async () => undefined);
        expect(service.getPanelState("first-project-panel")).toBeUndefined();
        await service.teardown(ctx2);
    });
});
