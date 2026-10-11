import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import type { AgentSettingsSnapshot } from "@shared/agent/settings";
import type { AppWindow } from "../appWindow";
import {
    AgentClientSetupHandler,
    AgentCopyConfigHandler,
    AgentInstallSkillHandler,
    AgentExportSkillHandler,
    AgentQuickStateHandler,
    AgentQuickToggleHandler,
    AgentRequestFolderAccessHandler,
    AgentRevealExportedSkillHandler,
} from "./agentQuickAction";

/**
 * The workspace's Agent menu reaches agent access through these handlers, and a workspace runs
 * plugin code. So the one property worth pinning is what they do NOT hand back: whatever the manager
 * underneath knows - token, address, port - the answers are the three booleans, `{ copied: true }`,
 * or the folder an export wrote.
 */

const clipboardWrites: string[] = [];
vi.mock("electron", () => ({
    clipboard: { writeText: (text: string) => clipboardWrites.push(text) },
}));

const TOKEN = "t".repeat(48);
const SNAPSHOT: AgentSettingsSnapshot = {
    enabled: true,
    allowWrites: false,
    fullAccess: false,
    port: 54080,
    token: TOKEN,
    allowedImportRoots: ["/Users/author/Pictures"],
    running: true,
    url: "http://127.0.0.1:54080/mcp",
    error: null,
    stdio: { command: "/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio", args: ["--mcp-stdio"] },
    pluginTools: [],
};

function makeWindow(windowType: WindowAppType = WindowAppType.Workspace, { inSetup = false }: { inSetup?: boolean } = {}) {
    const manager = {
        snapshot: vi.fn(async () => SNAPSHOT),
        quickToggle: vi.fn(async () => ({ ...SNAPSHOT, allowWrites: true })),
        clientConfig: vi.fn(async () => `claude mcp add --header "Authorization: Bearer ${TOKEN}"`),
        exportSkill: vi.fn(async () => ({ canceled: false as const, path: "/Users/author/Desktop/NarraLeaf-Skills" })),
        revealExportedSkill: vi.fn(() => true),
        requestFolderAccessForCall: vi.fn(async () => ({ granted: ["/Users/author/kit"], denied: [], pending: [], refused: [] })),
        clientSetup: vi.fn(async () => ({ url: SNAPSHOT.url, stdio: SNAPSHOT.stdio, skillTargets: {} })),
        installSkill: vi.fn(async () => ({ canceled: false as const, path: "/Users/author/.claude/skills" })),
    };
    const window = {
        getWindowType: () => windowType,
        app: { logger: { warn: vi.fn() } },
        getApp: () => ({ getAgentManager: () => manager, isFirstRunSetupOpen: () => inSetup }),
    } as unknown as AppWindow;
    return { window, manager };
}

/** Every key anywhere in a value, so a nested secret cannot slip past a top-level check. */
function allKeys(value: unknown, into: string[] = []): string[] {
    if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
            into.push(key);
            allKeys(inner, into);
        }
    }
    return into;
}

function expectNoSecret(result: unknown): void {
    const keys = allKeys(result);
    for (const forbidden of ["token", "url", "port", "stdio", "allowedImportRoots"]) {
        expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(result)).not.toContain(TOKEN);
}

beforeEach(() => {
    clipboardWrites.length = 0;
});

describe("the Agent menu's narrow handlers", () => {
    it("answer the state as four booleans and nothing else", async () => {
        const { window } = makeWindow();
        const result = await new AgentQuickStateHandler().handle(window);
        expect(result).toEqual({ success: true, data: { enabled: true, allowWrites: false, fullAccess: false, running: true } });
        expectNoSecret(result);
    });

    it("pass only the three switches to the manager and project its answer", async () => {
        const { window, manager } = makeWindow();
        const result = await new AgentQuickToggleHandler().handle(window, { allowWrites: true, fullAccess: "yes", port: 1, removeImportRoot: "/" } as never);
        expect(manager.quickToggle).toHaveBeenCalledWith(window, { allowWrites: true });
        expect(result).toEqual({ success: true, data: { enabled: true, allowWrites: true, fullAccess: false, running: true } });
        expectNoSecret(result);
        await new AgentQuickToggleHandler().handle(window, { fullAccess: true });
        expect(manager.quickToggle).toHaveBeenLastCalledWith(window, { fullAccess: true });
        expectNoSecret(result);
    });

    it("write a configuration to the clipboard and answer only that it did", async () => {
        const { window } = makeWindow();
        const result = await new AgentCopyConfigHandler().handle(window, { kind: "claudeCode" });
        expect(result).toEqual({ success: true, data: { copied: true } });
        expectNoSecret(result);
        expect(clipboardWrites).toHaveLength(1);
        expect(clipboardWrites[0]).toContain(TOKEN);
    });

    it("refuse a configuration kind that is not on the list", async () => {
        const { window, manager } = makeWindow();
        const result = await new AgentCopyConfigHandler().handle(window, { kind: "everything" as never });
        expect(result.success).toBe(false);
        expect(manager.clientConfig).not.toHaveBeenCalled();
        expect(clipboardWrites).toHaveLength(0);
    });

    it("answer the folder a skill export wrote, and whether it was revealed", async () => {
        const { window } = makeWindow();
        const exported = await new AgentExportSkillHandler().handle(window);
        expect(exported).toEqual({ success: true, data: { canceled: false, path: "/Users/author/Desktop/NarraLeaf-Skills" } });
        expectNoSecret(exported);
        expect(await new AgentRevealExportedSkillHandler().handle(window)).toEqual({ success: true, data: { revealed: true } });
    });

    it("refuse game windows, which run project code", async () => {
        for (const windowType of [WindowAppType.DevMode, WindowAppType.Launcher]) {
            const { window, manager } = makeWindow(windowType);
            expect((await new AgentQuickStateHandler().handle(window)).success).toBe(false);
            expect((await new AgentQuickToggleHandler().handle(window, { enabled: true })).success).toBe(false);
            expect((await new AgentCopyConfigHandler().handle(window, { kind: "json" })).success).toBe(false);
            expect((await new AgentExportSkillHandler().handle(window)).success).toBe(false);
            expect(manager.snapshot).not.toHaveBeenCalled();
            expect(manager.quickToggle).not.toHaveBeenCalled();
            expect(manager.exportSkill).not.toHaveBeenCalled();
        }
        expect(clipboardWrites).toHaveLength(0);
    });

    it("pass a folder request on with only the call id and the paths, from a workspace only", async () => {
        const { window, manager } = makeWindow();
        const result = await new AgentRequestFolderAccessHandler().handle(window, { callId: "call-1", paths: ["/Users/author/kit/a.png"], clientName: "spoofed" } as never);
        expect(manager.requestFolderAccessForCall).toHaveBeenCalledWith(window, { callId: "call-1", paths: ["/Users/author/kit/a.png"] });
        expect(result).toEqual({ success: true, data: { granted: ["/Users/author/kit"], denied: [], pending: [], refused: [] } });
        for (const windowType of [WindowAppType.Settings, WindowAppType.DevMode]) {
            const other = makeWindow(windowType);
            expect((await new AgentRequestFolderAccessHandler().handle(other.window, { callId: "call-1", paths: [] })).success).toBe(false);
            expect(other.manager.requestFolderAccessForCall).not.toHaveBeenCalled();
        }
    });
});

describe("first-run setup's hold on agent access", () => {
    it("lets the launcher through the menu's handlers only while setup is open", async () => {
        const setup = makeWindow(WindowAppType.Launcher, { inSetup: true });
        const state = await new AgentQuickStateHandler().handle(setup.window);
        expect(state.success).toBe(true);
        expectNoSecret(state);
        expect((await new AgentQuickToggleHandler().handle(setup.window, { enabled: true })).success).toBe(true);
        const copied = await new AgentCopyConfigHandler().handle(setup.window, { kind: "codex" });
        expect(copied).toEqual({ success: true, data: { copied: true } });
        expectNoSecret(copied);

        const home = makeWindow(WindowAppType.Launcher, { inSetup: false });
        expect((await new AgentQuickToggleHandler().handle(home.window, { enabled: true })).success).toBe(false);
        expect((await new AgentCopyConfigHandler().handle(home.window, { kind: "codex" })).success).toBe(false);
        expect(home.manager.quickToggle).not.toHaveBeenCalled();
    });

    it("answer the endpoint without the token, to Settings and setup only", async () => {
        for (const { windowType, inSetup } of [
            { windowType: WindowAppType.Launcher, inSetup: true },
            { windowType: WindowAppType.Settings, inSetup: false },
        ]) {
            const { window } = makeWindow(windowType, { inSetup });
            const result = await new AgentClientSetupHandler().handle(window);
            expect(result.success).toBe(true);
            expect(JSON.stringify(result)).not.toContain(TOKEN);
        }
        for (const { windowType, inSetup } of [
            { windowType: WindowAppType.Workspace, inSetup: true },
            { windowType: WindowAppType.Launcher, inSetup: false },
            { windowType: WindowAppType.DevMode, inSetup: true },
        ]) {
            const { window, manager } = makeWindow(windowType, { inSetup });
            expect((await new AgentClientSetupHandler().handle(window)).success).toBe(false);
            expect((await new AgentInstallSkillHandler().handle(window, { client: "claudeCode" })).success).toBe(false);
            expect(manager.clientSetup).not.toHaveBeenCalled();
            expect(manager.installSkill).not.toHaveBeenCalled();
        }
    });

    it("install only for a client that has a skill to install", async () => {
        const { window, manager } = makeWindow(WindowAppType.Launcher, { inSetup: true });
        expect(await new AgentInstallSkillHandler().handle(window, { client: "claudeCode" })).toEqual({
            success: true,
            data: { canceled: false, path: "/Users/author/.claude/skills" },
        });
        expect(manager.installSkill).toHaveBeenCalledWith(window, "claudeCode");
        for (const client of ["other", "everything"]) {
            expect((await new AgentInstallSkillHandler().handle(window, { client: client as never })).success).toBe(false);
        }
        expect(manager.installSkill).toHaveBeenCalledTimes(1);
    });
});
