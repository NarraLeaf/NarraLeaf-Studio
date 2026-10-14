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
        port: 41500,
        running: true,
        url: "http://127.0.0.1:41500/mcp",
        error: null,
        movedToPort: null,
        portUnavailable: null,
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
    /** What an update answers when it differs from what a read answers (a refusal is on the answer only). */
    updateAnswer: null as AgentSettingsSnapshot | null,
    /** The panel's handler for main's change notice, which main sends after every update. */
    quickStateChanged: null as null | (() => void),
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
            onQuickStateChanged: (handler: () => void) => {
                bridge.quickStateChanged = handler;
                return { cancel: () => undefined };
            },
            updateSettings: (patch: unknown) => {
                bridge.patches.push(patch);
                // Main's notice of the change lands after the answer, and the panel reads again.
                setTimeout(() => bridge.quickStateChanged?.(), 0);
                return Promise.resolve({ success: true, data: bridge.updateAnswer ?? bridge.settings });
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
    bridge.updateAnswer = null;
    bridge.quickStateChanged = null;
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

    it("moves the endpoint to a port typed into the port row", async () => {
        const view = await renderPanel();
        const field = view.getByRole("textbox", { name: "settings.agent.port" }) as HTMLInputElement;
        expect(field.value).toBe("41500");
        expect(view.getByText("settings.agent.portHint")).toBeTruthy();
        fireEvent.change(field, { target: { value: "50123" } });
        fireEvent.keyDown(field, { key: "Enter" });
        await waitFor(() => expect(bridge.patches).toEqual([{ port: 50123 }]));
    });

    it("asks main nothing for a port out of range, and puts the field back", async () => {
        const view = await renderPanel();
        const field = view.getByRole("textbox", { name: "settings.agent.port" }) as HTMLInputElement;
        fireEvent.change(field, { target: { value: "80" } });
        expect(view.getByText("settings.agent.portInvalid(1024|65535)")).toBeTruthy();
        fireEvent.blur(field);
        expect(field.value).toBe("41500");
        expect(bridge.patches).toEqual([]);
    });

    it("says why a port could not be used, beside the port the endpoint is still on", async () => {
        const view = await renderPanel();
        const field = view.getByRole("textbox", { name: "settings.agent.port" }) as HTMLInputElement;
        bridge.updateAnswer = snapshot({ portRefused: { port: 50123, reason: "reserved" } });
        fireEvent.change(field, { target: { value: "50123" } });
        fireEvent.keyDown(field, { key: "Enter" });
        await waitFor(() => expect(view.getByText("settings.agent.portReserved(50123)")).toBeTruthy());
        // Main's change notice is read again afterwards, without the refusal; the reason stays.
        await act(() => new Promise(resolve => setTimeout(resolve, 20)));
        expect(view.getByText("settings.agent.portReserved(50123)")).toBeTruthy();
        expect(field.value).toBe("41500");
        // Typing again clears it.
        fireEvent.change(field, { target: { value: "5012" } });
        expect(view.queryByText("settings.agent.portReserved(50123)")).toBeNull();
        expect(view.getByText("settings.agent.portHint")).toBeTruthy();
    });

    it("shows the address read-only, with a way to copy it", async () => {
        const view = await renderPanel();
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

    it("says the endpoint did not start, on which port and why, where it says it is running", async () => {
        const view = await renderPanel({ running: false, portUnavailable: { port: 41500, reason: "inUse" } });
        const status = view.getByText("settings.agent.failed(settings.agent.portInUse(41500))");
        expect(status.className).toContain("text-danger");
        expect(view.queryByText("settings.agent.stopped")).toBeNull();
        // The port row is where another port is set; it shows the port that failed.
        expect((view.getByRole("textbox", { name: "settings.agent.port" }) as HTMLInputElement).value).toBe("41500");
    });

    it("copies a configuration from the guide only, not from a second row of buttons", async () => {
        const view = await renderPanel();
        const guide = view.container.querySelector("[data-agent-client-guide]") as HTMLElement;
        const copyButtons = view.getAllByRole("button").filter(button => /copy/i.test(button.getAttribute("aria-label") ?? button.textContent ?? ""));
        // The address and the token each have their own; neither is a configuration.
        expect(copyButtons.filter(button => !guide.contains(button)).map(button => button.getAttribute("aria-label"))).toEqual([
            "settings.agent.copyAddress",
            "settings.agent.copyToken",
        ]);
    });

    it("shows the token masked but for its last characters, and copies it whole", async () => {
        const view = await renderPanel({ token: "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEF" });
        expect(view.getByText("••••••••CDEF")).toBeTruthy();
        expect(view.container.textContent).not.toContain("abcdefghij");
        // There is nothing to reveal: the row has no show button.
        expect(view.queryByText("settings.agent.show")).toBeNull();
        fireEvent.click(view.getByRole("button", { name: "settings.agent.copyToken" }));
        await waitFor(() => expect(bridge.clipboard).toEqual(["abcdefghijklmnopqrstuvwxyz0123456789-_ABCDEF"]));
    });

    it("leaves the moved-port notice standing when only the token is copied", async () => {
        const view = await renderPanel({ url: "http://127.0.0.1:47220/mcp", movedToPort: 47220 });
        fireEvent.click(view.getByRole("button", { name: "settings.agent.copyToken" }));
        await waitFor(() => expect(bridge.clipboard).toEqual(["secret-token"]));
        // A token says nothing about the port, so the configurations set up before still need copying again.
        expect(bridge.patches).toEqual([]);
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
