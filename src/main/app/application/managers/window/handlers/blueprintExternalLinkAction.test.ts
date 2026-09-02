import { describe, expect, it, vi } from "vitest";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn(async () => undefined) }));

vi.mock("electron", () => ({ shell: { openExternal } }));

// The trust gate reports where it refused in the workspace console; no such window exists here.
vi.mock("../../../utils/workspaceConsole", () => ({ emitWorkspaceConsoleLog: vi.fn() }));

const { BlueprintExternalLinkOpenHandler, BlueprintExternalLinkOpenForPluginHandler } = await import("./blueprintExternalLinkAction");

type AppWindowLike = Parameters<InstanceType<typeof BlueprintExternalLinkOpenHandler>["handle"]>[0];

/** A Dev Mode window on one project, whose ledger answer a case chooses. */
function makeWindow(options: { trusted: boolean }): AppWindowLike {
    const app = {
        projectTrustManager: { isTrusted: () => options.trusted },
        pluginManager: { listRuntimePlugins: async () => [] },
    };
    return {
        getProps: () => ({ projectPath: "D:/games/project" }),
        getApp: () => app,
        app,
    } as unknown as AppWindowLike;
}

const REQUEST = { projectPath: "D:/games/project", request: { url: "https://store.example.com/page" } };

/**
 * Handing an address to the system browser is the project reaching an address it chose, by way of
 * the author's machine. A trusted project's request is decided on its scheme as the packaged game
 * decides it; a distrusted project's is refused before the scheme is looked at.
 */
describe("blueprint external links and project trust", () => {
    it("opens a trusted project's address", async () => {
        openExternal.mockClear();

        const result = await new BlueprintExternalLinkOpenHandler().handle(makeWindow({ trusted: true }), REQUEST as never);

        expect(result.success).toBe(true);
        expect(openExternal).toHaveBeenCalledWith("https://store.example.com/page");
    });

    it("refuses a distrusted project's address", async () => {
        openExternal.mockClear();

        const result = await new BlueprintExternalLinkOpenHandler().handle(makeWindow({ trusted: false }), REQUEST as never);

        expect(result.success).toBe(false);
        expect(result.error).toContain("not trusted");
        expect(openExternal).not.toHaveBeenCalled();
    });

    it("refuses a distrusted project's plugin request before reading any declaration", async () => {
        openExternal.mockClear();

        const result = await new BlueprintExternalLinkOpenForPluginHandler().handle(
            makeWindow({ trusted: false }),
            { ...REQUEST, pluginId: "example.plugin" } as never,
        );

        expect(result.success).toBe(false);
        expect(openExternal).not.toHaveBeenCalled();
    });
});
