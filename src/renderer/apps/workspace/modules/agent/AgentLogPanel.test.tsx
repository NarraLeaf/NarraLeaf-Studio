// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentActivityEntry } from "@/lib/workspace/services/agent/AgentActivityLog";
import { Services } from "@/lib/workspace/services/services";
import { AgentLogPanel } from "./AgentLogPanel";

/**
 * What the Agent log shows the author about a call: a plugin tool under the plugin's name, never its
 * id, and a refusal's two lines labelled as what the agent was told.
 */

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}(${Object.values(params).join("|")})` : key,
        has: () => false,
        tn: (key: string, count: number) => `${key}(${count})`,
        formatNumber: (value: number) => String(value),
        locale: "zh",
    }),
}));

const listPlugins = vi.hoisted(() => vi.fn());

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        plugins: { list: listPlugins },
        app: { launchSettings: vi.fn() },
        workspace: { exportConsoleLogs: vi.fn() },
    }),
}));

const workspace = vi.hoisted(() => ({ entries: [] as AgentActivityEntry[] }));

vi.mock("../../context", () => ({
    useWorkspace: () => ({
        context: {
            services: {
                get: (name: string) => {
                    switch (name) {
                        case Services.AgentBridge:
                            return {
                                getActivityLog: () => ({
                                    getEntries: () => workspace.entries,
                                    subscribe: () => () => undefined,
                                    clear: () => undefined,
                                }),
                            };
                        case Services.PanelState:
                            return { getPanelState: () => undefined, setPanelState: () => undefined };
                        default:
                            return {};
                    }
                },
            },
        },
    }),
}));

function entry(overrides: Partial<AgentActivityEntry>): AgentActivityEntry {
    return {
        id: 1,
        startedAt: 0,
        tool: "acme_notes__add",
        clientName: "Claude Code",
        write: true,
        side: "workspace",
        status: "ok",
        durationMs: 12,
        target: null,
        reveal: null,
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    workspace.entries = [];
    listPlugins.mockReset();
});

describe("the Agent log", () => {
    it("names a plugin tool's plugin in the interface language, never by its id", async () => {
        listPlugins.mockResolvedValue({
            success: true,
            data: { plugins: [{ pluginId: "acme.notes", manifest: { id: "acme.notes", name: "Notes", localized: { zh: { name: "笔记" } } } }] },
        });
        workspace.entries = [entry({ pluginId: "acme.notes", title: "Add a note" })];
        const view = render(<AgentLogPanel panelId="agent-log" />);

        await waitFor(() => expect(view.getByText("笔记")).toBeTruthy());
        expect(view.getByText("笔记").getAttribute("data-tip")).toBe("workspace.agent.log.pluginTool(笔记)");
        expect(view.container.innerHTML).not.toContain("acme.notes");
    });

    it("leaves a plugin no longer installed unnamed rather than printing its id", async () => {
        listPlugins.mockResolvedValue({ success: true, data: { plugins: [] } });
        workspace.entries = [entry({ pluginId: "acme.gone", title: "Add a note" })];
        const view = render(<AgentLogPanel panelId="agent-log" />);

        await waitFor(() => expect(listPlugins).toHaveBeenCalled());
        expect(view.getByText("Add a note")).toBeTruthy();
        expect(view.container.innerHTML).not.toContain("acme.gone");
    });

    it("labels a refusal's lines as what the agent was told", () => {
        workspace.entries = [entry({
            tool: "build",
            status: "refused",
            code: "writes_disabled",
            message: "build changes the project.",
            hint: "Ask the author.",
        })];
        const view = render(<AgentLogPanel panelId="agent-log" />);
        fireEvent.click(view.getByRole("listitem").querySelector("button[aria-expanded]")!);

        expect(view.getByText("workspace.agent.log.message")).toBeTruthy();
        expect(view.getByText("workspace.agent.log.hint")).toBeTruthy();
        expect(listPlugins).not.toHaveBeenCalled();
    });
});
