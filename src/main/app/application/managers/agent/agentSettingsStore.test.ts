import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_MCP_DEFAULT_PORT, AGENT_MCP_FALLBACK_PORTS, AGENT_MCP_LEGACY_DEFAULT_PORT } from "@shared/agent/protocol";
import { AGENT_SETTINGS_FILE_NAME, AGENT_SETTINGS_SCHEMA_VERSION, buildAgentClientConfig } from "@shared/agent/settings";
import { AgentSettingsStore, mintAgentToken } from "./agentSettingsStore";

describe("AgentSettingsStore", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-settings-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const file = () => path.join(dir, AGENT_SETTINGS_FILE_NAME);
    const mode = () => fs.statSync(file()).mode & 0o777;

    it("starts off, on the default port, with a fresh token written owner-only", async () => {
        const settings = await new AgentSettingsStore(dir).load();
        expect(settings).toMatchObject({ enabled: false, allowWrites: false, fullAccess: false, port: AGENT_MCP_DEFAULT_PORT, url: null, allowedImportRoots: [] });
        expect(settings.token.length).toBeGreaterThanOrEqual(40);
        const onDisk = JSON.parse(fs.readFileSync(file(), "utf8"));
        expect(onDisk.token).toBe(settings.token);
        if (process.platform !== "win32") {
            expect(mode()).toBe(0o600);
        }
    });

    it("keeps the token across loads and persists changes", async () => {
        const first = new AgentSettingsStore(dir);
        const { token } = await first.load();
        await first.update(draft => {
            draft.enabled = true;
            draft.port = 50123;
            draft.url = "http://127.0.0.1:50123/mcp";
            draft.allowedImportRoots.push({ path: "/art" });
        });
        const second = await new AgentSettingsStore(dir).load();
        expect(second).toMatchObject({ enabled: true, port: 50123, token, allowedImportRoots: [{ path: "/art" }] });
        // The previous run's live address is not live any more.
        expect(second.url).toBeNull();
    });

    it("tightens a file left readable by someone else", async () => {
        if (process.platform === "win32") {
            return;
        }
        fs.writeFileSync(file(), JSON.stringify({ token: mintAgentToken(), enabled: true }), { mode: 0o644 });
        const store = new AgentSettingsStore(dir);
        await store.load();
        await store.update(draft => {
            draft.allowWrites = true;
        });
        expect(mode()).toBe(0o600);
    });

    it("falls back field by field on a malformed file, and mints a token for a weak one", async () => {
        fs.writeFileSync(file(), JSON.stringify({ enabled: "yes", port: 80, token: "short", allowedImportRoots: [{ path: 3 }, { path: "/ok" }, { path: "/ok" }] }));
        const settings = await new AgentSettingsStore(dir).load();
        expect(settings.enabled).toBe(false);
        expect(settings.port).toBe(AGENT_MCP_DEFAULT_PORT);
        expect(settings.token).not.toBe("short");
        expect(settings.allowedImportRoots).toEqual([{ path: "/ok" }]);
    });

    it("keeps full access only when it is literally true, and writes it owner-only", async () => {
        fs.writeFileSync(file(), JSON.stringify({ token: mintAgentToken(), fullAccess: "true" }));
        expect((await new AgentSettingsStore(dir).load()).fullAccess).toBe(false);
        const store = new AgentSettingsStore(dir);
        await store.load();
        await store.update(draft => {
            draft.fullAccess = true;
        });
        const reread = await new AgentSettingsStore(dir).load();
        expect(reread).toMatchObject({ fullAccess: true, allowWrites: false });
        if (process.platform !== "win32") {
            expect(mode()).toBe(0o600);
        }
    });

    it("moves a profile written before schema 2 off the old default port, once, and remembers it was enabled there", async () => {
        const token = mintAgentToken();
        fs.writeFileSync(file(), JSON.stringify({ schemaVersion: 1, token, enabled: true, port: AGENT_MCP_LEGACY_DEFAULT_PORT }));
        const store = new AgentSettingsStore(dir);
        const settings = await store.load();
        expect(settings).toMatchObject({ port: AGENT_MCP_DEFAULT_PORT, token, enabled: true, schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION });
        // Written back at once, so the move is recorded and not made again.
        expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toMatchObject({ schemaVersion: 2, port: AGENT_MCP_DEFAULT_PORT });
        // Clients were configured with the old port; the manager is told once.
        expect(store.takeLegacyPort()).toBe(AGENT_MCP_LEGACY_DEFAULT_PORT);
        expect(store.takeLegacyPort()).toBeNull();
        expect(new AgentSettingsStore(dir).takeLegacyPort()).toBeNull();
    });

    it("moves a disabled profile off the old default without anything to tell", async () => {
        fs.writeFileSync(file(), JSON.stringify({ token: mintAgentToken(), enabled: false, port: AGENT_MCP_LEGACY_DEFAULT_PORT }));
        const store = new AgentSettingsStore(dir);
        expect((await store.load()).port).toBe(AGENT_MCP_DEFAULT_PORT);
        expect(store.takeLegacyPort()).toBeNull();
    });

    it("keeps 54080 in a schema 2 file, where it is a port the endpoint landed on, and keeps any other old port", async () => {
        fs.writeFileSync(file(), JSON.stringify({ schemaVersion: 2, token: mintAgentToken(), enabled: true, port: AGENT_MCP_LEGACY_DEFAULT_PORT }));
        const kept = new AgentSettingsStore(dir);
        expect((await kept.load()).port).toBe(AGENT_MCP_LEGACY_DEFAULT_PORT);
        expect(kept.takeLegacyPort()).toBeNull();
        fs.writeFileSync(file(), JSON.stringify({ schemaVersion: 1, token: mintAgentToken(), enabled: true, port: 50123 }));
        const chosen = new AgentSettingsStore(dir);
        expect((await chosen.load()).port).toBe(50123);
        expect(chosen.takeLegacyPort()).toBeNull();
    });

    it("survives unparseable JSON", async () => {
        fs.writeFileSync(file(), "{not json");
        const settings = await new AgentSettingsStore(dir).load();
        expect(settings.enabled).toBe(false);
    });

    it("lands concurrent updates in order", async () => {
        const store = new AgentSettingsStore(dir);
        await store.load();
        await Promise.all([
            store.update(draft => { draft.port = 40001; }),
            store.update(draft => { draft.allowWrites = true; }),
        ]);
        const reread = await new AgentSettingsStore(dir).load();
        expect(reread).toMatchObject({ port: 40001, allowWrites: true });
    });
});

describe("the endpoint's ports", () => {
    it("start below Windows' dynamic range, where reserved blocks answer EACCES, and stay there", () => {
        expect(AGENT_MCP_DEFAULT_PORT).toBe(47219);
        expect(AGENT_MCP_FALLBACK_PORTS).toEqual([47220, 47221, 47222, 47223, 47224, 47225, 47226, 47227, 47228]);
        for (const port of [AGENT_MCP_DEFAULT_PORT, ...AGENT_MCP_FALLBACK_PORTS]) {
            expect(port).toBeLessThan(49152);
        }
    });
});

describe("buildAgentClientConfig", () => {
    const url = "http://127.0.0.1:47219/mcp";
    const token = "abc";

    it("gives Claude Code a command line", () => {
        expect(buildAgentClientConfig("claudeCode", url, token)).toBe(
            `claude mcp add --scope user --transport http narraleaf ${url} --header "Authorization: Bearer abc"`,
        );
    });

    it("gives the mcpServers JSON shape", () => {
        expect(JSON.parse(buildAgentClientConfig("json", url, token))).toEqual({
            mcpServers: { narraleaf: { type: "http", url, headers: { Authorization: "Bearer abc" } } },
        });
    });

    it("gives stdio-only clients Studio's own executable as a bridge, with no token in it", () => {
        const stdio = { command: "/Applications/NarraLeaf Studio.app/Contents/MacOS/NarraLeaf Studio", args: ["--mcp-stdio"] };
        const text = buildAgentClientConfig("stdio", url, token, stdio);
        expect(JSON.parse(text)).toEqual({ mcpServers: { narraleaf: stdio } });
        expect(text).not.toContain(token);
        expect(() => buildAgentClientConfig("stdio", url, token)).toThrow();
    });

    it("gives opencode its remote block", () => {
        expect(JSON.parse(buildAgentClientConfig("opencode", url, token))).toEqual({
            mcp: { narraleaf: { type: "remote", url, headers: { Authorization: "Bearer abc" } } },
        });
    });
});
