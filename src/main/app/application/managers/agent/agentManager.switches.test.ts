import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAccessPromptProps } from "@shared/types/agentAccess";
import { WindowAppType } from "@shared/types/window";
import { withAgentProjectArgument } from "@shared/agent/pluginTools";
import { AGENT_TOOLS } from "@shared/agent/tools";
import type { App } from "../../../app";
import type { AppWindow } from "../window/appWindow";

/**
 * The manager's switches, as a workspace's Agent menu and the Settings window reach them.
 *
 * A workspace runs plugin code, so what is pinned here is which of its requests are put to the
 * author first: turning agent access on, like turning writes on, is asked in Studio's own agent
 * access window, and nothing changes unless the author says yes. The Settings window is Studio's
 * own and is not asked again.
 */

vi.mock("electron", () => ({
    shell: { showItemInFolder: vi.fn() },
}));

vi.mock("../window/fileDialog", () => ({
    dialogTranslator: () => ({ t: (key: string) => key }),
    showOpenDialog: vi.fn(),
}));

vi.mock("./agentStdioMain", () => ({
    agentStdioCommand: () => ({ command: "studio", args: ["--mcp-stdio"] }),
}));

const servers: { started: number; stopped: number } = { started: 0, stopped: 0 };

vi.mock("./agentMcpServer", () => ({
    AgentMcpServer: class {
        public port: number | null = null;
        constructor(private readonly options: { port: number }) {}
        public async start(): Promise<number> {
            servers.started += 1;
            this.port = this.options.port;
            return this.options.port;
        }
        public async stop(): Promise<void> {
            servers.stopped += 1;
            this.port = null;
        }
        public notifyToolsChanged(): void {}
    },
}));

const { AgentManager } = await import("./agentManager");

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-manager-"));
    servers.started = 0;
    servers.stopped = 0;
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

type FakePlugin = { pluginId: string; enabled: boolean; builtIn?: boolean; manifest: { name: string; contributes: { agentTools?: { name: string; write: boolean }[] } } };

function makeManager(
    answer: boolean | null,
    options: { windows?: unknown[]; plugins?: () => Promise<FakePlugin[]>; trusted?: (projectPath: string) => boolean } = {},
) {
    const asked: AgentAccessPromptProps[] = [];
    const app = {
        getUserDataDir: () => dir,
        askAgentAccess: vi.fn(async (_window: AppWindow, props: AgentAccessPromptProps) => {
            asked.push(props);
            return answer === null ? null : { allowed: answer };
        }),
        logger: { info: vi.fn(), warn: vi.fn() },
        windowManager: { getWindows: () => options.windows ?? [] },
        electronApp: { on: vi.fn(), getPath: () => dir },
        pluginManager: { listPlugins: options.plugins ?? (async () => []) },
        getAppInfo: () => ({ version: "1.0.0" }),
        projectTrustManager: { isTrusted: options.trusted ?? (() => true) },
        storageManager: { grantFileSystemAccess: vi.fn() },
        getAppPath: () => path.join(dir, "app"),
        getResourcesDir: () => path.join(dir, "resources"),
    };
    const manager = new AgentManager(app as unknown as App);
    const window = { refuseUnattendedPrompt: vi.fn() } as unknown as AppWindow;
    return { manager, asked, window };
}

describe("turning agent access on", () => {
    it("is asked in the agent access window when a workspace's menu asks, and a no changes nothing", async () => {
        const { manager, asked, window } = makeManager(false);
        const snapshot = await manager.quickToggle(window, { enabled: true });
        expect(asked).toEqual([{ kind: "enable" }]);
        expect(snapshot.enabled).toBe(false);
        expect(snapshot.running).toBe(false);
        expect(servers.started).toBe(0);
        expect(window.refuseUnattendedPrompt).toHaveBeenCalledTimes(1);
    });

    it("reads closing the window without an answer as no", async () => {
        const { manager, window } = makeManager(null);
        expect((await manager.quickToggle(window, { enabled: true })).enabled).toBe(false);
        expect(servers.started).toBe(0);
    });

    it("starts the endpoint once the author allows it", async () => {
        const { manager, asked, window } = makeManager(true);
        const snapshot = await manager.quickToggle(window, { enabled: true });
        expect(asked).toEqual([{ kind: "enable" }]);
        expect(snapshot.enabled).toBe(true);
        expect(snapshot.running).toBe(true);
        expect(servers.started).toBe(1);
    });

    it("drops the rest of a menu request the author declined, writes included", async () => {
        const { manager, asked, window } = makeManager(false);
        const snapshot = await manager.quickToggle(window, { enabled: true, allowWrites: true });
        expect(asked).toEqual([{ kind: "enable" }]);
        expect(snapshot.enabled).toBe(false);
        expect(snapshot.allowWrites).toBe(false);
    });

    it("is not asked again when agent access is already on", async () => {
        const { manager, asked, window } = makeManager(true);
        await manager.updateSettings({ enabled: true });
        expect((await manager.quickToggle(window, { enabled: true })).enabled).toBe(true);
        expect(asked).toEqual([]);
    });

    it("is not asked from the Settings window, whose switch is already the author's answer", async () => {
        const { manager, asked, window } = makeManager(false);
        const snapshot = await manager.updateSettings({ enabled: true }, window);
        expect(asked).toEqual([]);
        expect(snapshot.enabled).toBe(true);
        expect(servers.started).toBe(1);
    });
});

describe("turning agent access off", () => {
    it("needs no confirmation from a workspace's menu", async () => {
        const { manager, asked, window } = makeManager(false);
        await manager.updateSettings({ enabled: true });
        const snapshot = await manager.quickToggle(window, { enabled: false });
        expect(asked).toEqual([]);
        expect(snapshot.enabled).toBe(false);
        expect(snapshot.running).toBe(false);
        expect(servers.stopped).toBe(1);
    });
});

describe("turning write access on from a workspace's menu", () => {
    it("is still asked separately", async () => {
        const { manager, asked, window } = makeManager(false);
        await manager.updateSettings({ enabled: true });
        expect((await manager.quickToggle(window, { allowWrites: true })).allowWrites).toBe(false);
        expect(asked).toEqual([{ kind: "allowWrites" }]);
    });
});

/**
 * What a workspace reports as its plugins' agent tools, held to the installed plugins' manifests.
 * A workspace runs plugin code, so a report is a claim: only a tool an enabled plugin declares, with
 * the same write flag, reaches `tools/list`.
 */
describe("reported plugin tools", () => {
    function workspace() {
        return {
            getWindowType: () => WindowAppType.Workspace,
            isClosed: () => false,
            getProps: () => ({ projectPath: dir }),
            onEvent: vi.fn(),
        };
    }

    const tool = (pluginId: string, local: string, write: boolean) => ({
        name: `${pluginId.replace(/[.-]/g, "_")}__${local}`,
        title: `Tool ${local}`,
        description: "Does a thing.",
        side: "workspace",
        write,
        inputSchema: withAgentProjectArgument({ type: "object", properties: {} }),
        pluginId,
        pluginName: "Claimed name",
        pluginToolName: `${pluginId}.${local}`,
    });

    const gallery: FakePlugin = {
        pluginId: "narraleaf.gallery",
        enabled: true,
        manifest: { name: "Gallery", contributes: { agentTools: [{ name: "narraleaf.gallery.add", write: true }, { name: "narraleaf.gallery.list", write: false }] } },
    };

    it("lists only what an installed, enabled plugin declares, the way it declares it", async () => {
        const window = workspace();
        const { manager } = makeManager(true, { windows: [window], plugins: async () => [gallery] });
        await manager.updateSettings({});
        await manager.reportPluginTools(window as never, [
            tool("narraleaf.gallery", "add", true),
            // Declared as reading, reported as writing.
            tool("narraleaf.gallery", "list", true),
            // Not declared at all.
            tool("narraleaf.gallery", "delete_all", true),
            // No such plugin installed.
            tool("acme.spy", "read", false),
            // An empty plugin id would map onto an internal call's name.
            { ...tool("x", "build", true), pluginId: "", pluginToolName: ".build", name: "__build" },
        ]);
        const plugin = manager.listTools().filter(entry => "pluginId" in entry);
        expect(plugin.map(entry => entry.name)).toEqual(["narraleaf_gallery__add"]);
        expect(plugin[0]).toMatchObject({ pluginName: "Gallery", write: true });
        expect(manager.findTool("__build")).toBeNull();
    });

    it("drops a report a newer one overtook while it was being checked", async () => {
        const window = workspace();
        let release: () => void = () => undefined;
        const slow = new Promise<void>(resolve => {
            release = resolve;
        });
        let holdNext = false;
        const { manager } = makeManager(true, {
            windows: [window],
            plugins: async () => {
                if (holdNext) {
                    holdNext = false;
                    await slow;
                }
                return [gallery];
            },
        });
        await manager.updateSettings({});
        holdNext = true;
        const first = manager.reportPluginTools(window as never, [tool("narraleaf.gallery", "add", true)]);
        await manager.reportPluginTools(window as never, [tool("narraleaf.gallery", "list", false)]);
        release();
        await first;
        expect(manager.listTools().filter(entry => "pluginId" in entry).map(entry => entry.name)).toEqual(["narraleaf_gallery__list"]);
    });

    it("advertises nothing when the installed plugins cannot be read", async () => {
        const window = workspace();
        const { manager } = makeManager(true, { windows: [window], plugins: async () => Promise.reject(new Error("disk gone")) });
        await manager.updateSettings({});
        await manager.reportPluginTools(window as never, [tool("narraleaf.gallery", "add", true)]);
        expect(manager.listTools().some(entry => "pluginId" in entry)).toBe(false);
    });
});

/**
 * A project the author has not trusted is somebody else's: an agent may read it, but main refuses
 * its changes and its folder grants before the workspace or the author hears of them, and tells the
 * workspace on every call so it can refuse the same again.
 */
describe("an untrusted project", () => {
    const writeTool = AGENT_TOOLS.find(tool => tool.side === "workspace" && tool.write)!;
    const readTool = AGENT_TOOLS.find(tool => tool.side === "workspace" && !tool.write)!;

    function workspace() {
        return {
            getWindowType: () => WindowAppType.Workspace,
            isClosed: () => false,
            getProps: () => ({ projectPath: dir }),
            onEvent: vi.fn(),
            sendIpcEvent: vi.fn(),
            invokeIpcRequest: vi.fn(async () => ({ success: true, data: { ok: true, content: [{ type: "text", text: "done" }] } })),
        };
    }

    it("has its changes refused in main, and its reads carried out with the trust attached", async () => {
        const window = workspace();
        const { manager } = makeManager(true, { windows: [window], trusted: () => false });
        await manager.updateSettings({ allowWrites: true });

        const write = await manager.callTool(writeTool, {}, { clientName: null });
        expect(write).toMatchObject({ ok: false, error: { code: "untrusted" } });
        expect(window.invokeIpcRequest).not.toHaveBeenCalled();

        expect((await manager.callTool(readTool, {}, { clientName: null })).ok).toBe(true);
        const [, request] = window.invokeIpcRequest.mock.calls[0] as unknown as [unknown, { policy: { projectTrusted?: boolean } }];
        expect(request.policy.projectTrusted).toBe(false);
    });

    it("is given no folder, from a dialog or under full access", async () => {
        const window = workspace();
        const { manager, asked } = makeManager(true, { windows: [window], trusted: () => false });
        await manager.updateSettings({ allowWrites: true, fullAccess: true });
        const handle = { projectPath: dir, name: null, window } as never;
        const answer = await manager.requestFolderAccess(handle, [path.join(dir, "..", "kit", "a.png")], { clientName: null });
        expect(answer.granted).toEqual([]);
        expect(answer.refused.map(entry => entry.reason)).toEqual(["untrusted"]);
        expect(asked).toEqual([]);
    });

    it("leaves a trusted project's calls as they were", async () => {
        const window = workspace();
        const { manager } = makeManager(true, { windows: [window] });
        await manager.updateSettings({ allowWrites: true });
        expect((await manager.callTool(writeTool, {}, { clientName: null })).ok).toBe(true);
        const [, request] = window.invokeIpcRequest.mock.calls[0] as unknown as [unknown, { policy: { projectTrusted?: boolean } }];
        expect(request.policy.projectTrusted).toBe(true);
    });
});
