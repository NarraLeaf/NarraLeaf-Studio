// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSettingsSnapshot } from "@shared/agent/settings";
import { AgentAccessPanel } from "./AgentAccessPanel";

/**
 * The agent access panel in Settings: what its rows are called and where keyboard focus goes.
 * Main owns every value shown here, so the bridge is a stub that answers with a fixed snapshot.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join("|")})` : key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        formatList: (items: string[]) => items.join(" + "),
        locale: "en",
    }),
}));

function snapshot(overrides: Partial<AgentSettingsSnapshot> = {}): AgentSettingsSnapshot {
    return {
        enabled: true,
        allowWrites: false,
        fullAccess: false,
        token: "secret-token",
        allowedImportRoots: [],
        running: true,
        url: "http://127.0.0.1:41500/mcp",
        error: null,
        movedToPort: null,
        stdio: { command: "C:\\Studio\\NarraLeaf Studio.exe", args: ["--mcp-stdio"] },
        pluginTools: [],
        ...overrides,
    };
}

const bridge = vi.hoisted(() => ({
    settings: null as AgentSettingsSnapshot | null,
    regenerate: null as null | ((value: unknown) => void),
    patches: [] as unknown[],
    clipboard: [] as string[],
    /** What main was asked to copy or install, by the guide. */
    mainCopies: [] as string[],
    installs: [] as string[],
}));

vi.mock("@shared/utils/copyText", () => ({
    copyTextToClipboard: async (text: string) => {
        bridge.clipboard.push(text);
    },
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        agent: {
            getSettings: () => Promise.resolve({ success: true, data: bridge.settings }),
            onQuickStateChanged: () => ({ cancel: () => undefined }),
            updateSettings: (patch: unknown) => {
                bridge.patches.push(patch);
                return Promise.resolve({ success: true, data: bridge.settings });
            },
            regenerateToken: () => new Promise(resolve => {
                bridge.regenerate = resolve;
            }),
            addImportRoot: () => Promise.resolve({ success: true, data: bridge.settings }),
            clientSetup: () => Promise.resolve({
                success: true,
                data: {
                    url: bridge.settings?.url ?? "",
                    stdio: bridge.settings?.stdio ?? { command: "", args: [] },
                    skillTargets: { claudeCode: { displayPath: "~/.claude/skills", installed: false } },
                },
            }),
            copyConfig: (kind: string) => {
                bridge.mainCopies.push(kind);
                return Promise.resolve({ success: true, data: { copied: true } });
            },
            installSkill: (client: string) => {
                bridge.installs.push(client);
                return Promise.resolve({ success: true, data: { canceled: false, path: "/Users/author/.claude/skills" } });
            },
        },
    }),
}));

afterEach(() => {
    cleanup();
    bridge.settings = null;
    bridge.regenerate = null;
    bridge.patches = [];
    bridge.clipboard = [];
    bridge.mainCopies = [];
    bridge.installs = [];
});

async function renderPanel(overrides: Partial<AgentSettingsSnapshot> = {}) {
    bridge.settings = snapshot(overrides);
    const view = render(<AgentAccessPanel />);
    await waitFor(() => expect(view.getByText("settings.agent.enable")).toBeTruthy());
    return view;
}

describe("the agent access panel", () => {
    it("titles each row on its own, the way the Agent menu names the same switch", async () => {
        const view = await renderPanel();
        for (const key of [
            "settings.agent.allowWrites",
            "settings.agent.fullAccess",
            "settings.agent.endpoint",
            "settings.agent.regenerate",
        ]) {
            expect(view.getByText(key)).toBeTruthy();
        }
    });

    it("asks for no port: the address is shown, read-only, with a way to copy it", async () => {
        const view = await renderPanel();
        expect(view.queryByText("settings.agent.port")).toBeNull();
        expect(view.container.querySelector("input")).toBeNull();
        // The address row; the guide further down names the address inside a configuration as well.
        expect(view.container.querySelector('[data-tip="http://127.0.0.1:41500/mcp"]')?.textContent).toBe("http://127.0.0.1:41500/mcp");
        expect(view.getByText("settings.agent.running")).toBeTruthy();
        fireEvent.click(view.getByRole("button", { name: "settings.agent.copyAddress" }));
        await waitFor(() => expect(bridge.clipboard).toEqual(["http://127.0.0.1:41500/mcp"]));
        // Nothing moved, so there is nothing to answer.
        expect(bridge.patches).toEqual([]);
    });

    it("says the endpoint moved, and answers it once the address is copied", async () => {
        const view = await renderPanel({ url: "http://127.0.0.1:47220/mcp", movedToPort: 47220 });
        const notice = view.getByText("settings.agent.portMoved(47220)");
        expect(notice.className).toContain("text-warning");
        expect(view.queryByText("settings.agent.running")).toBeNull();
        fireEvent.click(view.getByRole("button", { name: "settings.agent.copyAddress" }));
        await waitFor(() => expect(bridge.patches).toEqual([{ acknowledgeMovedPort: true }]));
        expect(bridge.clipboard).toEqual(["http://127.0.0.1:47220/mcp"]);
    });

    it("copies a configuration from the guide only, not from a second row of buttons", async () => {
        const view = await renderPanel();
        const guide = view.container.querySelector("[data-agent-client-guide]") as HTMLElement;
        const copyButtons = view.getAllByRole("button").filter(button => /copy/i.test(button.getAttribute("aria-label") ?? button.textContent ?? ""));
        expect(copyButtons.filter(button => !guide.contains(button)).map(button => button.getAttribute("aria-label"))).toEqual(["settings.agent.copyAddress"]);
    });

    it("walks one agent application through, as first-run setup does, with the token masked", async () => {
        const view = await renderPanel();
        const guide = view.container.querySelector("[data-agent-client-guide]") as HTMLElement;
        expect(view.getByText("settings.agent.guide.app")).toBeTruthy();
        await waitFor(() => expect(guide.textContent).toContain("claude mcp add"));
        expect(guide.textContent).not.toContain("secret-token");
        expect(guide.textContent).toContain("settings.agent.guide.runCommand");

        // Copying hands the kind to main, which writes the real configuration to the clipboard.
        fireEvent.click(within(guide).getByRole("button", { name: "common.copy" }));
        await waitFor(() => expect(bridge.mainCopies).toEqual(["claudeCode"]));
        expect(bridge.clipboard).toEqual([]);

        await waitFor(() => expect(guide.textContent).toContain("settings.agent.guide.skillFolder(~/.claude/skills)"));
        fireEvent.click(within(guide).getByRole("button", { name: "settings.agent.guide.skillInstall" }));
        await waitFor(() => expect(bridge.installs).toEqual(["claudeCode"]));

        // Another application: its own place for the configuration, and its own way to the skill.
        fireEvent.click(view.getByRole("button", { name: "settings.agent.guide.app" }));
        fireEvent.click(view.getByText("Claude Desktop"));
        await waitFor(() => expect(guide.textContent).toContain("settings.agent.guide.claudeDesktop"));
        expect(within(guide).getByRole("button", { name: "settings.agent.guide.skillSave" })).toBeTruthy();
    });

    it("names a plugin with agent tools by its display name, never by its id", async () => {
        const view = await renderPanel({
            pluginTools: [{ pluginId: "acme.notes", name: "Notes", tools: 3, writeTools: 1, allowed: true, builtIn: false }],
        });
        expect(view.getByText("Notes").getAttribute("data-tip")).toBe("Notes");
        expect(view.container.innerHTML).not.toContain("acme.notes");
    });

    it("keeps keyboard focus in the panel through regenerating the token", async () => {
        const view = await renderPanel();
        const regenerate = () => view.getByRole("button", { name: "settings.agent.regenerateAction" });

        // Opening the confirm step removes the focused button; Cancel takes focus instead.
        regenerate().focus();
        fireEvent.click(regenerate());
        const cancel = view.getByRole("button", { name: "common.cancel" });
        expect(document.activeElement).toBe(cancel);

        // Cancelling hands focus back to the button that replaces the step.
        fireEvent.click(cancel);
        await waitFor(() => expect(document.activeElement).toBe(regenerate()));

        // Confirming does the same, once the regeneration has answered and the button is enabled.
        fireEvent.click(regenerate());
        fireEvent.click(view.getAllByRole("button", { name: "settings.agent.regenerateAction" })[0]);
        expect(bridge.regenerate).not.toBeNull();
        await act(async () => {
            bridge.regenerate?.({ success: true, data: snapshot({ token: "new-token" }) });
        });
        await waitFor(() => expect(document.activeElement).toBe(regenerate()));
        expect((regenerate() as HTMLButtonElement).disabled).toBe(false);
    });
});
