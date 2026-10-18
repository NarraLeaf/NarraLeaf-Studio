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
 *
 * A model is imported through the model import wizard, as everywhere else in Studio; and in a picker
 * that chooses one asset, only the caller's answer wears the tick.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSelector } from "./AssetSelector";
import type { ModelImportSelection } from "./ModelImportWizard";

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
const patchAssetExtras = vi.fn(async (): Promise<unknown> => ({ success: true as const, data: {} }));

/**
 * Held identities, not fresh literals.
 *
 * The picker keys several effects on the workspace context and on the library it was handed, so a
 * mock that rebuilt either on every render would re-run them forever - a defect in the test, not in
 * the component. `vi.hoisted` is what puts them above the `vi.mock` factories that close over them.
 */
const stable = vi.hoisted(() => ({
    library: { assets: {}, groups: {} } as { assets: Record<string, unknown[]>; groups: Record<string, unknown[]> },
    context: null as unknown,
    /** The model import wizard's props as the picker last rendered them. */
    wizard: null as null | {
        visible: boolean;
        family?: string;
        tickLoneModel?: boolean;
        onImport: (selection: ModelImportSelection[]) => void;
        onClose: () => void;
    },
}));

// Keys, not prose: what is asserted is which control is off and which reason is given, and English
// wording is free to change without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string) => key,
        tn: (key: string, count: number) => `${key}:${count}`,
        formatList: (items: string[]) => items.join(", "),
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
// panel state it remembers its expanded folders in, the notice a dialog that would not open gets, and
// the project's languages and editions a set member's tags are printed with.
vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: () => ({
            importFromPaths,
            patchAssetExtras,
            showNotification,
            getPanelState: () => undefined,
            setPanelState: () => undefined,
            getConfiguration: () => ({ sourceLocale: "en", locales: [] }),
            onConfigChanged: () => () => undefined,
            listTags: () => [],
            onTagsChanged: () => () => undefined,
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

// The wizard has its own scan and its own folder dialog; what is pinned here is how the picker opens
// it and what it does with the folders it hands back.
vi.mock("./ModelImportWizard", () => ({
    ModelImportWizard: (props: NonNullable<typeof stable.wizard>) => {
        stable.wizard = props;
        return null;
    },
}));

afterEach(() => {
    cleanup();
    stable.wizard = null;
    stable.library = { assets: {}, groups: {} };
    patchAssetExtras.mockClear();
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

function open(
    assetType: AssetType = AssetType.Image,
    extra: Partial<React.ComponentProps<typeof AssetSelector>> = {},
): void {
    render(
        <AssetSelector
            visible
            assetType={assetType}
            onClose={() => undefined}
            onConfirm={() => undefined}
            {...extra}
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

const HIYORI: ModelImportSelection = { rootPath: "D:/models/hiyori", entry: "Hiyori.model3.json" };

async function handBack(selection: ModelImportSelection[]): Promise<void> {
    await act(async () => {
        stable.wizard!.onImport(selection);
    });
}

describe("AssetSelector model import through the wizard", () => {
    it("opens the wizard on the caller's kind, a lone model ticked, rather than a bare folder dialog", async () => {
        open(AssetType.Model, { modelFamily: "live2d" });
        expect(stable.wizard?.visible).toBe(false);

        await clickImport();

        expect(stable.wizard).toMatchObject({ visible: true, family: "live2d", tickLoneModel: true });
        expect(selectDirectory).not.toHaveBeenCalled();
        expect(selectFile).not.toHaveBeenCalled();
        expect(importFromPaths).not.toHaveBeenCalled();
        // The picker steps aside for the dialog, and comes back when it closes.
        expect(screen.queryByRole("button", { name: "assets.selector.importFromDisk" })).toBeNull();
        await act(async () => {
            stable.wizard!.onClose();
        });
        expect(stable.wizard?.visible).toBe(false);
        expect(importButton()).toBeTruthy();
    });

    it("imports the folder the wizard settled on and records its entry", async () => {
        importFromPaths.mockImplementationOnce(async () => ({
            success: true as const,
            data: [{ success: true as const, data: { id: "hiyori-1", name: "Hiyori-1" } }],
        }) as never);
        open(AssetType.Model);
        await clickImport();
        await handBack([HIYORI]);

        expect(importFromPaths).toHaveBeenCalledWith(AssetType.Model, ["D:/models/hiyori"], expect.anything());
        expect(patchAssetExtras).toHaveBeenCalledWith({ id: "hiyori-1", name: "Hiyori-1" }, { modelEntry: "Hiyori.model3.json" });
        expect(stable.wizard?.visible).toBe(false);
    });

    it("refuses before the wizard opens on a frozen workspace", async () => {
        frozen = true;
        open(AssetType.Model);

        await clickImport();
        expect(stable.wizard?.visible).toBe(false);
    });
});

describe("AssetSelector ticks after an import", () => {
    // jsdom lays nothing out and has no CSS namespace. The picker scrolls a row into view and
    // escapes an id into a selector, neither of which is what these cases look at.
    Element.prototype.scrollIntoView = () => undefined;
    vi.stubGlobal("CSS", { escape: (value: string) => value });

    const MODELS = [
        { id: "hiyori", name: "Hiyori", type: AssetType.Model, tags: [] },
        { id: "hiyori-1", name: "Hiyori-1", type: AssetType.Model, tags: [] },
    ];
    const ticked = () => [...document.body.querySelectorAll("[data-asset-id]")]
        .filter(row => row.querySelector("svg.lucide-check"))
        .map(row => row.getAttribute("data-asset-id"));

    async function importHiyoriAgain(multiple: boolean): Promise<void> {
        importFromPaths.mockImplementationOnce(async () => {
            // The library the picker reloads after the copy holds the new model beside the old one.
            stable.library = { assets: { model: MODELS }, groups: {} };
            return { success: true as const, data: [{ success: true as const, data: MODELS[1] }] } as never;
        });
        stable.library = { assets: { model: MODELS.slice(0, 1) }, groups: {} };
        open(AssetType.Model, { selectedIds: ["hiyori"], multiple });
        await clickImport();
        await handBack([HIYORI]);
    }

    it("keeps the one tick on what the caller has when it chooses one", async () => {
        await importHiyoriAgain(false);
        expect(ticked()).toEqual(["hiyori"]);
    });

    it("ticks what was imported beside it when it chooses several", async () => {
        await importHiyoriAgain(true);
        expect(ticked()).toEqual(["hiyori", "hiyori-1"]);
    });
});
