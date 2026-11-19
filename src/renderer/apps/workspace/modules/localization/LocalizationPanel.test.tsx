// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Services } from "@/lib/workspace/services/services";
import { LocalizationPanel } from "./LocalizationPanel";

const mocks = vi.hoisted(() => ({ context: null as unknown, collect: vi.fn() }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("../../registry", () => ({ useRegistry: () => ({ openEditorTab: vi.fn() }) }));
vi.mock("@/lib/ui-editor/hooks/useUIDocumentRevision", () => ({ useUIDocumentRevision: () => 0 }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string, values?: { completed?: number; total?: number }) => (
        key === "workspace.localization.panel.progress" ? `${values?.completed}/${values?.total}` : key
    ) }),
}));
vi.mock("../../components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("../../components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(false, "frozen") };
});
vi.mock("./translationExchange", () => ({
    collectTranslatableUnits: mocks.collect,
    useTranslationExchange: () => ({ exportLanguage: vi.fn(), importLanguage: vi.fn() }),
}));

afterEach(() => { cleanup(); mocks.collect.mockReset(); });

describe("LocalizationPanel progress", () => {
    it("keeps the newest story data when an older collection finishes later", async () => {
        let changed = () => {};
        let finishOld!: (rows: unknown[]) => void;
        mocks.collect
            .mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
            .mockResolvedValueOnce([{ unitId: "one" }, { unitId: "two" }]);
        const services: Record<string, unknown> = {
            [Services.Story]: {
                onLibraryChanged: () => () => {},
                onDocumentChanged: (listener: () => void) => { changed = listener; return () => {}; },
            },
            [Services.Localization]: {
                getConfiguration: () => ({ sourceLocale: "en", locales: [
                    { code: "en", displayName: "English" }, { code: "ja", displayName: "Japanese" },
                ] }),
                onConfigChanged: () => () => {},
                onKeysChanged: () => () => {},
                onDocumentChanged: () => () => {},
                loadDocument: () => Promise.resolve({}),
                computeProgress: (rows: unknown[]) => ({ completed: rows.length, total: rows.length, stale: 0 }),
            },
            [Services.Character]: { subscribe: () => () => {} },
            [Services.UIDocument]: null,
            [Services.UI]: {},
        };
        mocks.context = { services: { get: (id: string) => services[id] } };
        render(<LocalizationPanel panelId="localization" />);
        await waitFor(() => expect(mocks.collect).toHaveBeenCalledTimes(1));
        act(() => changed());
        await screen.findByText("2/2");
        await act(async () => { finishOld([{ unitId: "old" }]); });
        expect(screen.getByText("2/2")).toBeTruthy();
    });

    it("hides progress while the complete list cannot be read", async () => {
        let changed = () => {};
        mocks.collect
            .mockResolvedValueOnce([{ unitId: "one" }])
            .mockRejectedValueOnce(new Error("story unreadable"));
        const services: Record<string, unknown> = {
            [Services.Story]: {
                onLibraryChanged: () => () => {},
                onDocumentChanged: (listener: () => void) => { changed = listener; return () => {}; },
            },
            [Services.Localization]: {
                getConfiguration: () => ({ sourceLocale: "en", locales: [
                    { code: "en", displayName: "English" }, { code: "ja", displayName: "Japanese" },
                ] }),
                onConfigChanged: () => () => {}, onKeysChanged: () => () => {}, onDocumentChanged: () => () => {},
                loadDocument: () => Promise.resolve({}),
                computeProgress: (rows: unknown[]) => ({ completed: rows.length, total: rows.length, stale: 0 }),
            },
            [Services.Character]: { subscribe: () => () => {} },
            [Services.UIDocument]: null,
            [Services.UI]: {},
        };
        mocks.context = { services: { get: (id: string) => services[id] } };
        render(<LocalizationPanel panelId="localization" />);
        await screen.findByText("1/1");
        act(() => changed());
        await waitFor(() => expect(mocks.collect).toHaveBeenCalledTimes(2));
        expect(screen.queryByText("1/1")).toBeNull();
        expect(screen.queryByText("0/0")).toBeNull();
        expect(screen.getByText("Japanese")).toBeTruthy();
    });
});
