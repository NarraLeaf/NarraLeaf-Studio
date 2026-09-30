import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDependencyResolution } from "@shared/types/pluginDependencies";
import type { WorkspaceContext } from "@/lib/workspace/services/services";

const activateWorkspacePlugin = vi.fn(async (_context: unknown, pluginId: string) => ({ pluginId, ok: true as const }));
vi.mock("./pluginRuntime", () => ({
    activateWorkspacePlugin: (context: unknown, pluginId: string) => activateWorkspacePlugin(context, pluginId),
}));

const { rescanProjectDependencies } = await import("./rescanDependencies");

function resolution(suppressedPluginIds: string[]): ProjectDependencyResolution {
    return { entries: [], suppressedPluginIds, overall: suppressedPluginIds.length > 0 ? "blocked" : "ok" };
}

function contextWith(before: string[], after: string[]) {
    const service = {
        getSuppressedPluginIds: vi.fn(() => before),
        rescanAndPersist: vi.fn(async () => resolution(after)),
    };
    const context = { services: { get: () => service } } as unknown as WorkspaceContext;
    return { context, service };
}

describe("rescanProjectDependencies", () => {
    beforeEach(() => {
        activateWorkspacePlugin.mockClear();
    });

    /** The author's button, and so the one scan allowed to release a plugin held back for its version. */
    it("asks for the author's Rescan, not an automatic scan", async () => {
        const { context, service } = contextWith([], []);
        await rescanProjectDependencies(context);
        expect(service.rescanAndPersist).toHaveBeenCalledWith("rescan");
    });

    it("starts every plugin the Rescan released, and none that is still held", async () => {
        const { context } = contextWith(["narraleaf.gallery", "acme.fx"], ["acme.fx"]);
        const result = await rescanProjectDependencies(context);
        expect(activateWorkspacePlugin.mock.calls.map(call => call[1])).toEqual(["narraleaf.gallery"]);
        expect(result.suppressedPluginIds).toEqual(["acme.fx"]);
    });

    it("starts nothing when nothing was held", async () => {
        const { context } = contextWith([], []);
        await rescanProjectDependencies(context);
        expect(activateWorkspacePlugin).not.toHaveBeenCalled();
    });

    it("answers with the written table even when a released plugin fails to start", async () => {
        activateWorkspacePlugin.mockRejectedValueOnce(new Error("no descriptor list"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { context } = contextWith(["narraleaf.gallery"], []);
        await expect(rescanProjectDependencies(context)).resolves.toEqual(resolution([]));
        warn.mockRestore();
    });
});
