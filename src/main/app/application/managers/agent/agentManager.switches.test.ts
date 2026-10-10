import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAccessPromptProps } from "@shared/types/agentAccess";
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

function makeManager(answer: boolean | null) {
    const asked: AgentAccessPromptProps[] = [];
    const app = {
        getUserDataDir: () => dir,
        askAgentAccess: vi.fn(async (_window: AppWindow, props: AgentAccessPromptProps) => {
            asked.push(props);
            return answer === null ? null : { allowed: answer };
        }),
        logger: { info: vi.fn(), warn: vi.fn() },
        windowManager: { getWindows: () => [] },
        electronApp: { on: vi.fn(), getPath: () => dir },
        pluginManager: { listPlugins: async () => [] },
        getAppInfo: () => ({ version: "1.0.0" }),
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
