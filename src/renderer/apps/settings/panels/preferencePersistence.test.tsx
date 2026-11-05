// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadSourcesPanel } from "./DownloadSourcesPanel";
import { KeybindingsPanel } from "./KeybindingsPanel";
import { DOWNLOAD_REWRITES_KEY } from "@shared/types/downloadSource";

const fixture = vi.hoisted(() => ({
    stored: {} as Record<string, unknown>,
    fail: false,
    listeners: new Set<(change: { key: string; value: unknown }) => void>(),
    writes: [] as unknown[],
}));
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: async (key: string) => ({ success: true, data: { value: fixture.stored[key] } }),
    onGlobalStateChanged: (listener: (change: { key: string; value: unknown }) => void) => {
        fixture.listeners.add(listener);
        return { cancel: () => fixture.listeners.delete(listener) };
    },
    setGlobalState: async (key: string, value: unknown) => {
        fixture.writes.push(value);
        if (fixture.fail) return { success: false, error: "disk full" };
        fixture.stored[key] = value;
        fixture.listeners.forEach(listener => listener({ key, value }));
        return { success: true };
    },
} } }) }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/app/platform", () => ({ isMacPlatform: () => false }));
vi.mock("@/lib/workspace/services/ui/KeybindingService", () => ({
    KEYBINDING_OVERRIDES_SETTINGS_KEY: "keybindings.overrides",
    sanitizeKeybindingOverrides: (value: unknown) => value && typeof value === "object" ? value : {},
    formatKeybinding: (value: string) => value,
    keybindingFromKeyboardEvent: () => "ctrl+k",
}));
vi.mock("@/lib/workspace/services/ui/keybindingCatalog", async importOriginal => ({
    ...await importOriginal<typeof import("@/lib/workspace/services/ui/keybindingCatalog")>(),
    KEYBINDING_CATALOG: [],
}));
vi.mock("@/apps/workspace/modules/assets/components/SearchBox", () => ({ SearchBox: () => null }));

beforeEach(() => { fixture.stored = {}; fixture.fail = false; fixture.listeners.clear(); fixture.writes = []; });
afterEach(cleanup);

describe("settings panel persistence", () => {
    it("keeps a failed mirror draft visible and retries the unchanged value", async () => {
        const original = { from: "https://origin.example/", to: "https://mirror.example/", enabled: true };
        fixture.stored[DOWNLOAD_REWRITES_KEY] = [original];
        render(<DownloadSourcesPanel />);
        await screen.findByDisplayValue(original.to);
        fixture.fail = true;
        fireEvent.change(screen.getByDisplayValue(original.to), { target: { value: "https://new.example/" } });
        await screen.findByRole("alert");
        expect(fixture.stored[DOWNLOAD_REWRITES_KEY]).toEqual([original]);
        expect(screen.getByDisplayValue("https://new.example/")).toBeTruthy();
        fixture.fail = false;
        fireEvent.click(screen.getByText("common.retry"));
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        expect(fixture.writes).toHaveLength(2);
        expect(fixture.stored[DOWNLOAD_REWRITES_KEY]).toEqual([{ ...original, to: "https://new.example/" }]);
    });

    it("retains a failed shortcut reset and exposes retry", async () => {
        fixture.stored["keybindings.overrides"] = { "plugin.action": "ctrl+k" };
        render(<KeybindingsPanel />);
        await screen.findByText("workspace.shell.keybindings.resetAll");
        fixture.fail = true;
        fireEvent.click(screen.getByText("workspace.shell.keybindings.resetAll"));
        await screen.findByRole("alert");
        expect(fixture.stored["keybindings.overrides"]).toEqual({ "plugin.action": "ctrl+k" });
        fixture.fail = false;
        await act(async () => { fireEvent.click(screen.getByText("common.retry")); });
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        expect(fixture.stored["keybindings.overrides"]).toEqual({});
    });
});
