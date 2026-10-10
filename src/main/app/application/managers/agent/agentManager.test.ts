import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { agentText, type AgentCallRequest } from "@shared/agent/protocol";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";

vi.mock("electron", () => ({
    shell: { showItemInFolder: vi.fn() },
    dialog: {},
}));

import { AgentManager } from "./agentManager";
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
});
