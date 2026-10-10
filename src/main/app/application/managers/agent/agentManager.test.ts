import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { agentText, type AgentCallRequest } from "@shared/agent/protocol";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import { normalizeProjectPath } from "@shared/utils/recentProject";

vi.mock("electron", () => ({
    shell: { showItemInFolder: vi.fn() },
    dialog: {},
}));

import { AgentManager } from "./agentManager";
import { IPC_PAGE_GONE } from "../window/ipcHost";
import { agentCallTimeoutMs } from "./agentCallTimeout";

/**
 * The manager's own decisions about a call, with Electron and the workspace windows stood in for:
 * what it sends a workspace, and what it answers when the workspace does not.
 */

const temporaryDirs: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    for (const dir of temporaryDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

type FakeWorkspace = ReturnType<typeof fakeWorkspace>;

function fakeWorkspace(projectPath: string) {
    return {
        getWindowType: () => WindowAppType.Workspace,
        isClosed: () => false,
        getProps: () => ({ projectPath }),
        sendIpcEvent: vi.fn(),
        invokeIpcRequest: vi.fn(async (_event: unknown, _request: AgentCallRequest, _options?: { timeoutMs?: number }): Promise<unknown> => ({
            success: true,
            data: agentText("done"),
        })),
    };
}

async function createManager(workspaces: FakeWorkspace[], settings: { allowWrites?: boolean } = {}) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nls-agent-manager-"));
    temporaryDirs.push(userDataDir);
    const app = {
        getUserDataDir: () => userDataDir,
        windowManager: { getWindows: () => workspaces },
        logger: { info: vi.fn(), warn: vi.fn() },
        projectTrustManager: { isTrusted: () => true },
        storageManager: { grantFileSystemAccess: vi.fn() },
    };
    const manager = new AgentManager(app as never);
    // `initialize` also listens on Electron's app; the calls under test only need the settings.
    const store = (manager as unknown as { store: { load(): Promise<unknown>; update(change: (draft: { allowWrites: boolean }) => void): Promise<unknown> } }).store;
    await store.load();
    if (settings.allowWrites) {
        await store.update(draft => {
            draft.allowWrites = true;
        });
    }
    return manager;
}

function tool(name: string) {
    const descriptor = AGENT_TOOLS_BY_NAME.get(name);
    if (!descriptor) {
        throw new Error(`No tool ${name}`);
    }
    return descriptor;
}

const ctx = { clientName: "test-client" };

describe("AgentManager calls", () => {
    it("sends each call with an absolute deadline that is also where its own wait ends", async () => {
        const workspace = fakeWorkspace("/games/a");
        const manager = await createManager([workspace]);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(1_000_000);
        await manager.callTool(tool("story_list"), {}, ctx);
        const [, request, options] = workspace.invokeIpcRequest.mock.calls[0];
        expect(request.deadline).toBe(1_000_000 + agentCallTimeoutMs("story_list"));
        expect(options?.timeoutMs).toBe(agentCallTimeoutMs("story_list"));
    });

    it("tells the agent a timed-out call that never started will not run", async () => {
        const workspace = fakeWorkspace("/games/a");
        workspace.invokeIpcRequest.mockRejectedValueOnce(new Error("IPC invoke timed out after 30000ms: workspaceAgentCall"));
        const manager = await createManager([workspace]);
        const result = await manager.callTool(tool("story_list"), {}, ctx);
        expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
        expect(result.ok ? "" : result.error.hint).toContain("it will not run at all");
    });

    it("answers at once when the workspace's page reloads mid-call, saying part of it may be done", async () => {
        const workspace = fakeWorkspace("/games/a");
        workspace.invokeIpcRequest.mockRejectedValueOnce(Object.assign(
            new Error("The page reloaded or navigated away before replying to IPC request: workspaceAgentCall"),
            { code: IPC_PAGE_GONE },
        ));
        const manager = await createManager([workspace]);
        const result = await manager.callTool(tool("story_list"), {}, ctx);
        expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
        expect(result.ok ? "" : result.error.message).toBe("The project's window reloaded, or its page crashed, before answering story_list.");
        expect(result.ok ? "" : result.error.hint).toContain("Part of it may have been done");
    });
});

describe("AgentManager routing with more than one project open", () => {
    const pathA = path.resolve("/games/a");
    const pathB = path.resolve("/games/b");

    /** Two workspaces, named, with B the one the author used last. */
    async function twoProjects() {
        const a = fakeWorkspace(pathA);
        const b = fakeWorkspace(pathB);
        const manager = await createManager([a, b], { allowWrites: true });
        const internals = manager as unknown as { focusedAt: WeakMap<object, number>; projectNames: Map<string, string | null> };
        internals.focusedAt.set(a, 100);
        internals.focusedAt.set(b, 200);
        internals.projectNames.set(normalizeProjectPath(pathA), "Night Train");
        internals.projectNames.set(normalizeProjectPath(pathB), "Rain");
        return { manager, a, b };
    }

    it("refuses a write that does not name its project, listing the open ones, and sends it nowhere", async () => {
        const { manager, a, b } = await twoProjects();
        const result = await manager.callTool(tool("scene_rename"), { scene: "s", name: "t" }, ctx);
        expect(result).toMatchObject({ ok: false, error: { code: "no_workspace" } });
        expect(result.ok ? "" : result.error.message).toContain("2 projects are open");
        expect(result.ok ? "" : result.error.hint).toBe(`Pass \`project\` with the path of one of them: Night Train (${pathA}), Rain (${pathB}).`);
        expect(a.invokeIpcRequest).not.toHaveBeenCalled();
        expect(b.invokeIpcRequest).not.toHaveBeenCalled();
    });

    it("refuses an unnamed build the same way, before the build is routed", async () => {
        const { manager, a, b } = await twoProjects();
        const result = await manager.callTool(tool("build"), { target: "web" }, ctx);
        expect(result).toMatchObject({ ok: false, error: { code: "no_workspace" } });
        expect(a.invokeIpcRequest).not.toHaveBeenCalled();
        expect(b.invokeIpcRequest).not.toHaveBeenCalled();
    });

    it("sends a write that names its project to that project, whatever the author focused", async () => {
        const { manager, a, b } = await twoProjects();
        const result = await manager.callTool(tool("scene_rename"), { scene: "s", name: "t", project: pathA }, ctx);
        expect(result.ok).toBe(true);
        expect(a.invokeIpcRequest).toHaveBeenCalledTimes(1);
        expect(b.invokeIpcRequest).not.toHaveBeenCalled();
    });

    it("still sends an unnamed read to the project the author used last", async () => {
        const { manager, a, b } = await twoProjects();
        expect((await manager.callTool(tool("story_list"), {}, ctx)).ok).toBe(true);
        expect(b.invokeIpcRequest).toHaveBeenCalledTimes(1);
        expect(a.invokeIpcRequest).not.toHaveBeenCalled();
    });

    it("sends an unnamed write to the only project open", async () => {
        const only = fakeWorkspace(pathA);
        const manager = await createManager([only], { allowWrites: true });
        expect((await manager.callTool(tool("scene_rename"), { scene: "s", name: "t" }, ctx)).ok).toBe(true);
        expect(only.invokeIpcRequest).toHaveBeenCalledTimes(1);
    });
});
