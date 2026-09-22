// @vitest-environment jsdom
/**
 * The picker's "Import from disk": on a frozen workspace, and when a file it was handed is refused.
 *
 * Two things make this control its own case rather than one more greyed button. It renders in a
 * portal on `document.body`, so nothing an opener wraps around its trigger reaches it; and the work
 * it starts opens the file dialog and copies every file the author picked into the library before
 * returning. A refusal that waits for the write is a refusal that arrives after the copy.
 *
 * And the import used to report nothing when a file was refused: the picker looked exactly as it
 * had, and the reason was a console line. It now reports through the asset panel's import strip.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSelector } from "./AssetSelector";

/** Flipped per case; read by the mocked hook below. */
let frozen = false;
const FREEZE_REASON = "frozen-reason";

/** What the file dialog answers, per case. */
let picked: { success: true; data: { ok: true; data: string[] } } | { success: false; error: string } = {
    success: true,
    data: { ok: true, data: [] },
};

const selectFile = vi.fn(async () => picked);
const selectDirectory = vi.fn(async () => picked);
const importFromPaths = vi.fn(async (_type: AssetType, paths: string[]) => ({
    success: true as const,
    data: paths.map(() => ({ success: true as const, data: { id: "new-asset" } })),
}));
const showNotification = vi.fn();

/**
 * Held identities, not fresh literals.
 *
 * The picker keys several effects on the workspace context and on the library it was handed, so a
 * mock that rebuilt either on every render would re-run them forever - a defect in the test, not in
 * the component. `vi.hoisted` is what puts them above the `vi.mock` factories that close over them.
 */
const stable = vi.hoisted(() => ({
    library: { assets: {}, groups: {} },
    context: null as unknown,
}));

// Keys, not prose: what is asserted is which control is off and which reason is given, and English
// wording is free to change without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string, count: number) => `${key}:${count}`,
        locale: "en",
    }),
}));

// The real hook reads the workspace freeze service through a provider this test has no business
// standing up, so the decision is supplied directly - the same decision the service would produce.
vi.mock("@/apps/workspace/components/ui/freezeGuard", async () => {
    const actual = await vi.importActual<typeof import("@/apps/workspace/components/ui/freezeGuard")>(
        "@/apps/workspace/components/ui/freezeGuard",
    );
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(frozen, FREEZE_REASON) };
});

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ fs: { selectFile, selectDirectory } }),
}));

// One stub answers every `services.get` the picker makes: the asset library it imports through, the
// panel state it remembers its expanded folders in, and the notice a dialog that would not open gets.
vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: () => ({
            importFromPaths,
            showNotification,
            getPanelState: () => undefined,
            setPanelState: () => undefined,
        }),
    };
    stable.context = { services };
    return { useWorkspace: () => ({ context: stable.context, isInitialized: true }) };
});

vi.mock("../state/useAssetData", () => ({
    useAssetData: () => ({
        assets: stable.library.assets,
        groups: stable.library.groups,
        loading: false,
        hasLoaded: true,
        loadFailed: false,
        loadAssets: async () => undefined,
    }),
}));

afterEach(() => {
    cleanup();
    frozen = false;
    picked = { success: true, data: { ok: true, data: [] } };
    selectFile.mockClear();
    selectDirectory.mockClear();
    importFromPaths.mockClear();
    showNotification.mockClear();
});

function importButton(): HTMLElement {
    return screen.getByRole("button", { name: "assets.selector.importFromDisk" });
}

function open(assetType: AssetType = AssetType.Image): void {
    render(
        <AssetSelector
            visible
            assetType={assetType}
            onClose={() => undefined}
            onConfirm={() => undefined}
        />,
    );
}

async function clickImport(): Promise<void> {
    await act(async () => {
        fireEvent.click(importButton());
    });
}

describe("AssetSelector import while the workspace is frozen", () => {
    it("imports the picked files when nothing is frozen", async () => {
        picked = { success: true, data: { ok: true, data: ["D:/art/a.png"] } };
        open();

        expect(importButton().matches(":disabled")).toBe(false);
        await clickImport();
        expect(selectFile).toHaveBeenCalledTimes(1);
        expect(importFromPaths).toHaveBeenCalledWith(AssetType.Image, ["D:/art/a.png"], expect.anything());
    });

    it("refuses before the file dialog opens", async () => {
        frozen = true;
        open();

        const button = importButton();
        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(button.matches(":disabled")).toBe(true);
        expect(button.getAttribute("data-tip")).toBe(FREEZE_REASON);

        await clickImport();
        expect(selectFile).not.toHaveBeenCalled();
        expect(importFromPaths).not.toHaveBeenCalled();
    });

    it("keeps the rest of the picker alive, because choosing writes nothing here", () => {
        frozen = true;
        open();

        // The picker hands its answer to the caller; whether that caller may write it is the
        // caller's question. Nothing else on this surface should be off because of the freeze.
        expect(screen.getByRole("button", { name: "common.close" }).matches(":disabled")).toBe(false);
        expect(screen.getByRole("button", { name: "assets.filter.label" }).matches(":disabled")).toBe(false);
    });
});

describe("AssetSelector import that fails", () => {
    it("names a refused file in the import strip, with the reason, and offers a retry", async () => {
        picked = { success: true, data: { ok: true, data: ["D:/art/good.png", "D:/art/empty.png"] } };
        importFromPaths.mockImplementationOnce(async () => ({
            success: true as const,
            data: [
                { success: true as const, data: { id: "good" } },
                // The importer's own sentence names the storage path; the refusal is what is shown.
                {
                    success: false as const,
                    error: "Failed to copy D:/art/empty.png to D:/game/assets/content/53/22/b0e3",
                    refusal: { kind: "empty" as const },
                } as never,
            ],
        }));
        open();

        await clickImport();

        expect(screen.getByText("assets.import.failedCount:1")).toBeTruthy();
        const row = screen.getByText("empty.png");
        expect(row.getAttribute("data-tip")).toContain("workspace.shell.import.reason.empty");
        expect(row.getAttribute("data-tip")).not.toContain("content/53");
        expect(screen.queryByText("good.png")).toBeNull();

        // The retry hands the same file back, without a second trip through the dialog.
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "assets.import.retry" }));
        });
        expect(selectFile).toHaveBeenCalledTimes(1);
        expect(importFromPaths).toHaveBeenLastCalledWith(AssetType.Image, ["D:/art/empty.png"], expect.anything());
    });

    it("picks a folder, not files, for a model", async () => {
        picked = { success: true, data: { ok: true, data: ["D:/models/hiyori"] } };
        open(AssetType.Model);

        await clickImport();
        expect(selectDirectory).toHaveBeenCalledTimes(1);
        expect(selectFile).not.toHaveBeenCalled();
        expect(importFromPaths).toHaveBeenCalledWith(AssetType.Model, ["D:/models/hiyori"], expect.anything());
    });

    it("says so when the file dialog cannot open, rather than doing nothing", async () => {
        picked = { success: false, error: "dialog failed" };
        open();

        await clickImport();
        expect(showNotification).toHaveBeenCalledWith("workspace.shell.fileDialogFailed", "error");
        expect(importFromPaths).not.toHaveBeenCalled();
    });

    it("stays quiet when the dialog is dismissed", async () => {
        open();

        await clickImport();
        expect(importFromPaths).not.toHaveBeenCalled();
        expect(showNotification).not.toHaveBeenCalled();
        expect(screen.queryByText(/assets\.import\.failedCount/)).toBeNull();
    });
});
