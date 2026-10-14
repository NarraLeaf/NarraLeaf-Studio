import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { ONBOARDING_VERSION } from "@shared/constants/onboarding";
import type { AgentSettingsSnapshot } from "@shared/agent/settings";
import type { AppWindow } from "../appWindow";
import { FirstRunSetupGate } from "../../../firstRunSetupGate";
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
 * underneath knows - token, address - the answers are the four booleans and the number of a port the
 * endpoint moved to, `{ copied: true }`, or the folder an export wrote.
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
    token: TOKEN,
    allowedImportRoots: ["/Users/author/Pictures"],
    port: 47219,
    running: true,
    url: "http://127.0.0.1:47219/mcp",
    error: null,
    movedToPort: null,
    portUnavailable: null,
    setByLaunch: false,
    stdio: { command: "/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio", args: ["--mcp-stdio"] },
    pluginTools: [],
};

/**
 * `inSetup` asks main's own gate to mark the window as the one it opened in first-run setup, the way
 * `App.launchLauncher` does. The gate, not the test, decides which window types that lets through.
 */
function makeWindow(
    windowType: WindowAppType = WindowAppType.Workspace,
    { inSetup = false, gate = new FirstRunSetupGate() }: { inSetup?: boolean; gate?: FirstRunSetupGate } = {},
) {
    const manager = {
        snapshot: vi.fn(async () => SNAPSHOT),
        quickToggle: vi.fn(async () => ({ ...SNAPSHOT, allowWrites: true })),
        updateSettings: vi.fn(async () => ({ ...SNAPSHOT, allowWrites: true })),
        clientConfig: vi.fn(async () => `claude mcp add --header "Authorization: Bearer ${TOKEN}"`),
        acknowledgeMovedPort: vi.fn(async () => undefined),
        exportSkill: vi.fn(async () => ({ canceled: false as const, path: "/Users/author/Desktop/NarraLeaf-Skills" })),
        revealExportedSkill: vi.fn(() => true),
        requestFolderAccessForCall: vi.fn(async () => ({ granted: ["/Users/author/kit"], denied: [], pending: [], refused: [] })),
        clientSetup: vi.fn(async () => ({ url: SNAPSHOT.url, stdio: SNAPSHOT.stdio, skillTargets: {} })),
        installSkill: vi.fn(async () => ({ canceled: false as const, path: "/Users/author/.claude/skills" })),
    };
    const window = {
        getWindowType: () => windowType,
        isClosed: () => false,
        app: { logger: { warn: vi.fn() } },
        getApp: () => ({ getAgentManager: () => manager, isFirstRunSetupWindow: (asked: AppWindow) => gate.passes(asked) }),
    } as unknown as AppWindow;
    if (inSetup) {
        gate.open(window);
    }
    return { window, manager, gate };
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
        expect(result).toEqual({ success: true, data: { enabled: true, allowWrites: false, fullAccess: false, running: true, movedToPort: null, portUnavailable: null, setByLaunch: false } });
        expectNoSecret(result);
    });

    it("tell the menu which port the endpoint moved to, as a number and with nothing that opens it", async () => {
        const { window, manager } = makeWindow();
        manager.snapshot.mockResolvedValueOnce({ ...SNAPSHOT, url: "http://127.0.0.1:47220/mcp", movedToPort: 47220 });
        const result = await new AgentQuickStateHandler().handle(window);
        expect(result).toEqual({ success: true, data: { enabled: true, allowWrites: false, fullAccess: false, running: true, movedToPort: 47220, portUnavailable: null, setByLaunch: false } });
        expectNoSecret(result);
        expect(JSON.stringify(result)).not.toContain("127.0.0.1");
    });

    it("pass only the three switches to the manager and project its answer", async () => {
        const { window, manager } = makeWindow();
        const result = await new AgentQuickToggleHandler().handle(window, { allowWrites: true, fullAccess: "yes", port: 1, removeImportRoot: "/" } as never);
        expect(manager.quickToggle).toHaveBeenCalledWith(window, { allowWrites: true });
        expect(result).toEqual({ success: true, data: { enabled: true, allowWrites: true, fullAccess: false, running: true, movedToPort: null, portUnavailable: null, setByLaunch: false } });
        expectNoSecret(result);
        await new AgentQuickToggleHandler().handle(window, { fullAccess: true });
        expect(manager.quickToggle).toHaveBeenLastCalledWith(window, { fullAccess: true });
        expectNoSecret(result);
    });

    it("write a configuration to the clipboard and answer only that it did", async () => {
        const { window, manager } = makeWindow();
        const result = await new AgentCopyConfigHandler().handle(window, { kind: "claudeCode" });
        expect(result).toEqual({ success: true, data: { copied: true } });
        expectNoSecret(result);
        expect(clipboardWrites).toHaveLength(1);
        expect(clipboardWrites[0]).toContain(TOKEN);
        // What was copied names the current port, which answers a notice that it moved.
        expect(manager.acknowledgeMovedPort).toHaveBeenCalledTimes(1);
    });

    it("refuse a configuration kind that is not on the list", async () => {
        const { window, manager } = makeWindow();
        const result = await new AgentCopyConfigHandler().handle(window, { kind: "everything" as never });
        expect(result.success).toBe(false);
        expect(manager.clientConfig).not.toHaveBeenCalled();
        expect(manager.acknowledgeMovedPort).not.toHaveBeenCalled();
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
            expect(manager.updateSettings).not.toHaveBeenCalled();
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
        expect(home.manager.updateSettings).not.toHaveBeenCalled();
    });

    it("switches access and writes from setup as Settings does, without a second confirmation", async () => {
        const setup = makeWindow(WindowAppType.Launcher, { inSetup: true });
        const result = await new AgentQuickToggleHandler().handle(setup.window, { enabled: true, allowWrites: true, removeImportRoot: "/" } as never);
        expect(result).toEqual({ success: true, data: { enabled: true, allowWrites: true, fullAccess: false, running: true, movedToPort: null, portUnavailable: null, setByLaunch: false } });
        expectNoSecret(result);
        // The window goes along so that full access, were it asked for, is still confirmed over it.
        expect(setup.manager.updateSettings).toHaveBeenCalledWith({ enabled: true, allowWrites: true }, setup.window);
        expect(setup.manager.quickToggle).not.toHaveBeenCalled();

        const workspace = makeWindow(WindowAppType.Workspace);
        await new AgentQuickToggleHandler().handle(workspace.window, { enabled: true });
        expect(workspace.manager.quickToggle).toHaveBeenCalledWith(workspace.window, { enabled: true });
        expect(workspace.manager.updateSettings).not.toHaveBeenCalled();
    });

    it("lets through only the launcher main opened in setup, not another launcher open beside it", async () => {
        const setup = makeWindow(WindowAppType.Launcher, { inSetup: true });
        const other = makeWindow(WindowAppType.Launcher, { gate: setup.gate });
        expect((await new AgentClientSetupHandler().handle(setup.window)).success).toBe(true);
        expect((await new AgentClientSetupHandler().handle(other.window)).success).toBe(false);
        expect((await new AgentInstallSkillHandler().handle(other.window, { client: "claudeCode" })).success).toBe(false);
        expect(other.manager.clientSetup).not.toHaveBeenCalled();
    });

    it("refuses setup again once the marker says it is finished, whatever the launch flags", async () => {
        const { window, manager, gate } = makeWindow(WindowAppType.Launcher, { inSetup: true });
        expect((await new AgentQuickStateHandler().handle(window)).success).toBe(true);
        gate.noteMarker(ONBOARDING_VERSION);
        expect((await new AgentQuickStateHandler().handle(window)).success).toBe(false);
        expect((await new AgentQuickToggleHandler().handle(window, { enabled: true })).success).toBe(false);
        expect((await new AgentClientSetupHandler().handle(window)).success).toBe(false);
        expect(manager.snapshot).toHaveBeenCalledTimes(1);
        expect(manager.clientSetup).not.toHaveBeenCalled();
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
