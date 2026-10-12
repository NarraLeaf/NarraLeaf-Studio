// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentClientGuide } from "./AgentClientGuide";

/**
 * The guide to one agent application, as first-run setup and Settings ▸ Agent access show it. Main
 * answers everything it shows, so the bridge is a stub; translations come back as their keys.
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

type Answer = { success: true; data: unknown } | { success: false; error?: string };

const bridge = vi.hoisted(() => ({
    exportSkill: null as null | (() => Promise<Answer>),
    installSkill: null as null | (() => Promise<Answer>),
    copyConfig: null as null | (() => Promise<Answer>),
    exports: 0,
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        agent: {
            clientSetup: () => Promise.resolve({
                success: true,
                data: {
                    url: "http://127.0.0.1:47219/mcp",
                    stdio: { command: "studio", args: ["--mcp-stdio"] },
                    skillTargets: { claudeCode: { displayPath: "~/.claude/skills", installed: false } },
                },
            }),
            copyConfig: () => bridge.copyConfig ? bridge.copyConfig() : Promise.resolve({ success: true, data: { copied: true } }),
            installSkill: () => bridge.installSkill ? bridge.installSkill() : Promise.resolve({ success: true, data: { canceled: true } }),
            exportSkill: () => {
                bridge.exports += 1;
                return bridge.exportSkill ? bridge.exportSkill() : Promise.resolve({ success: true, data: { canceled: true } });
            },
        },
    }),
}));

afterEach(() => {
    cleanup();
    bridge.exportSkill = null;
    bridge.installSkill = null;
    bridge.copyConfig = null;
    bridge.exports = 0;
});

describe("the guide for an application Studio has no skill folder for", () => {
    it("offers Studio's own skill export, not a third-party command", async () => {
        bridge.exportSkill = () => Promise.resolve({ success: true, data: { canceled: false, path: "/Users/author/Desktop/NarraLeaf-Skills" } });
        const view = render(<AgentClientGuide client="other" enabled />);
        expect(view.getByText("settings.agent.guide.skillServed")).toBeTruthy();
        expect(view.container.textContent).not.toContain("npx");

        fireEvent.click(view.getByRole("button", { name: "settings.agent.guide.skillExport" }));
        await waitFor(() => expect(view.getByText("settings.agent.guide.skillExported(/Users/author/Desktop/NarraLeaf-Skills)")).toBeTruthy());
        expect(bridge.exports).toBe(1);
    });

    it("keeps the sentence when the export is canceled", async () => {
        const view = render(<AgentClientGuide client="other" enabled />);
        fireEvent.click(view.getByRole("button", { name: "settings.agent.guide.skillExport" }));
        await waitFor(() => expect(bridge.exports).toBe(1));
        expect(view.getByText("settings.agent.guide.skillServed")).toBeTruthy();
    });
});

describe("what the guide says when main refuses", () => {
    const REASON = "EACCES: permission denied, mkdir '/Users/author/.claude/skills/narraleaf-make-game'";

    it("says an install failed in the author's language, with main's reason after it", async () => {
        bridge.installSkill = () => Promise.resolve({ success: false, error: REASON });
        const view = render(<AgentClientGuide client="claudeCode" enabled />);
        await waitFor(() => expect(view.getByRole("button", { name: "settings.agent.guide.skillInstall" })).toBeTruthy());
        fireEvent.click(view.getByRole("button", { name: "settings.agent.guide.skillInstall" }));
        await waitFor(() => expect(view.getByText(`settings.agent.guide.installFailed(${REASON})`)).toBeTruthy());
    });

    it("says a zip that could not be saved was not saved", async () => {
        bridge.installSkill = () => Promise.resolve({ success: false, error: REASON });
        const view = render(<AgentClientGuide client="claudeDesktop" enabled />);
        fireEvent.click(view.getByRole("button", { name: "settings.agent.guide.skillSave" }));
        await waitFor(() => expect(view.getByText(`settings.agent.guide.saveFailed(${REASON})`)).toBeTruthy());
    });

    it("says the same of a copy and of an export", async () => {
        bridge.copyConfig = () => Promise.resolve({ success: false, error: "A Launcher window cannot copy an agent configuration." });
        bridge.exportSkill = () => Promise.resolve({ success: false, error: REASON });
        const view = render(<AgentClientGuide client="other" enabled />);
        await waitFor(() => expect((view.getByRole("button", { name: "common.copy" }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(view.getByRole("button", { name: "common.copy" }));
        await waitFor(() => expect(view.getByText("settings.agent.guide.copyFailed(A Launcher window cannot copy an agent configuration.)")).toBeTruthy());
        fireEvent.click(view.getByRole("button", { name: "settings.agent.guide.skillExport" }));
        await waitFor(() => expect(view.getByText(`settings.agent.guide.exportFailed(${REASON})`)).toBeTruthy());
    });
});
