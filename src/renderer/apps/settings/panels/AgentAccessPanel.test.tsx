// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
        port: 41500,
        token: "secret-token",
        allowedImportRoots: [],
        running: true,
        url: "http://127.0.0.1:41500/mcp",
        error: null,
        stdio: { command: "C:\\Studio\\NarraLeaf Studio.exe", args: ["--mcp-stdio"] },
        pluginTools: [],
        ...overrides,
    };
}

const bridge = vi.hoisted(() => ({
    settings: null as AgentSettingsSnapshot | null,
    regenerate: null as null | ((value: unknown) => void),
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        agent: {
            getSettings: () => Promise.resolve({ success: true, data: bridge.settings }),
            onQuickStateChanged: () => ({ cancel: () => undefined }),
            updateSettings: () => Promise.resolve({ success: true, data: bridge.settings }),
            regenerateToken: () => new Promise(resolve => {
                bridge.regenerate = resolve;
            }),
            addImportRoot: () => Promise.resolve({ success: true, data: bridge.settings }),
        },
    }),
}));

afterEach(() => {
    cleanup();
    bridge.settings = null;
    bridge.regenerate = null;
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
            "settings.agent.port",
            "settings.agent.endpoint",
            "settings.agent.regenerate",
            "settings.agent.copyConfig",
        ]) {
            expect(view.getByText(key)).toBeTruthy();
        }
    });

    it("offers the configurations by client, in the Agent menu's order", async () => {
        const view = await renderPanel();
        const labels = view.getAllByRole("button")
            .map(button => button.textContent ?? "")
            .filter(text => text.startsWith("settings.agent.copy"));
        expect(labels).toEqual([
            "settings.agent.copyClaudeCode",
            "settings.agent.copyStdio",
            "settings.agent.copyOpencode",
            "settings.agent.copyJson",
        ]);
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
