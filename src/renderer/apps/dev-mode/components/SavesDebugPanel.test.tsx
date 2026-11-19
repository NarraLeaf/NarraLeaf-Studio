// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import type { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { GameAppSaveBridge, GameAppStoryRuntimeBridge } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { SavesDebugPanel } from "./SavesDebugPanel";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        formatDate: () => "",
        formatList: (items: string[]) => items.join(", "),
    }),
}));

afterEach(cleanup);

const bundle = { ui: { persistentVariables: {}, savedVariables: {} } } as unknown as DevModeBundle;
const storyRuntime = { getStoryContext: () => null, getVariableNamespaces: () => ({
    saved: null, visited: null, sceneLocal: {},
}) } as unknown as GameAppStoryRuntimeBridge;
const scopeBridge = {
    getPersistenceSnapshot: () => new Map(),
    subscribePersistence: () => () => undefined,
} as unknown as ScopeStoreBridge;

function renderPanel(saves: GameAppSaveBridge) {
    return render(<SavesDebugPanel saves={saves} storyRuntime={storyRuntime} scopeBridge={scopeBridge} bundle={bundle} />);
}

describe("SavesDebugPanel deletion", () => {
    it("keeps the selected slot and reports a failed deletion until the author retries", async () => {
        let ids = ["slot-1"];
        const remove = vi.fn()
            .mockRejectedValueOnce(new Error("Delete failed"))
            .mockImplementationOnce(async () => { ids = []; });
        const saves = {
            listIds: vi.fn(async () => ids),
            read: vi.fn(async () => ({ metadata: { user: "Chapter One" }, savedGame: { game: { store: { game: {} } } } })),
            remove,
            load: vi.fn(),
        } as unknown as GameAppSaveBridge;
        renderPanel(saves);

        fireEvent.click(await screen.findByText("Chapter One"));
        expect(screen.getByText("game")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "devMode.saves.delete" }));

        expect(await screen.findByText("Delete failed")).toBeTruthy();
        expect(screen.getByText("Chapter One")).toBeTruthy();
        expect(screen.getByText("game")).toBeTruthy();
        expect(saves.listIds).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole("button", { name: "devMode.saves.delete" }));
        await waitFor(() => expect(screen.queryByText("Chapter One")).toBeNull());
        expect(screen.queryByText("Delete failed")).toBeNull();
        expect(screen.getByText("devMode.saves.selectSlot")).toBeTruthy();
    });
});
