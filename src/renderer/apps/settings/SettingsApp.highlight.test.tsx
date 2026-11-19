// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsApp } from "./SettingsApp";

const fixture = vi.hoisted(() => ({
    highlight: null as null | ((value: string) => void),
    props: null as null | Promise<unknown>,
    values: {},
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        getWindowProps: () => fixture.props,
        app: {
            onSettingsHighlight: (listener: (value: string) => void) => {
                fixture.highlight = listener;
                return { cancel: () => { fixture.highlight = null; } };
            },
            spellcheck: { getStatus: async () => ({ success: true, data: { available: [] } }) },
        },
    }),
}));
vi.mock("@/lib/settings/useGlobalSettings", () => ({ useGlobalSettings: () => ({ values: fixture.values, loading: false }) }));
vi.mock("@/lib/settings/registry", () => ({
    getAllAppSettings: () => [],
    getAppSettingCategories: () => [{ key: "test", label: "Test", description: "", order: 0 }],
    getSettingByKey: (key: string) => key === "first" || key === "second" ? { key, category: "test" } : undefined,
    getSettingsByCategory: () => [],
    shownSettingValue: () => undefined,
}));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/components/layout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/help", () => ({ HelpOverlay: () => null, HelpTrigger: () => null, requestContextHelp: () => undefined }));
vi.mock("@/apps/workspace/modules/assets/components/SearchBox", () => ({
    SearchBox: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <input aria-label="Search" value={value} onChange={event => onChange(event.target.value)} />
    ),
}));
vi.mock("./components/SettingsNavTree", () => ({ SettingsNavTree: () => null }));
vi.mock("./components/SettingsExplorer", () => ({
    SettingsExplorer: ({ selectedSettingId }: { selectedSettingId?: string }) => <span>{selectedSettingId}</span>,
}));

afterEach(() => { cleanup(); fixture.highlight = null; fixture.props = null; });

describe("settings window highlight", () => {
    it("keeps the latest request when the initial window props arrive later", async () => {
        let resolve!: (value: unknown) => void;
        fixture.props = new Promise(done => { resolve = done; });
        render(<SettingsApp />);

        act(() => fixture.highlight?.("second"));
        expect(screen.getByText("second")).toBeTruthy();
        await act(async () => { resolve({ success: true, data: { highlight: "first" } }); });

        expect(screen.getByText("second")).toBeTruthy();
    });

    it("clears an old search so an externally requested setting is visible", async () => {
        fixture.props = Promise.resolve({ success: true, data: {} });
        render(<SettingsApp />);
        await act(async () => { await Promise.resolve(); });
        const search = screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement;
        fireEvent.change(search, { target: { value: "unrelated" } });

        act(() => fixture.highlight?.("second"));

        expect(screen.getByText("second")).toBeTruthy();
        expect(search.value).toBe("");
    });

    it("ignores an unknown request without losing the initial highlight", async () => {
        let resolve!: (value: unknown) => void;
        fixture.props = new Promise(done => { resolve = done; });
        render(<SettingsApp />);
        act(() => fixture.highlight?.("unknown"));
        await act(async () => { resolve({ success: true, data: { highlight: "first" } }); });
        expect(screen.getByText("first")).toBeTruthy();
    });
});
