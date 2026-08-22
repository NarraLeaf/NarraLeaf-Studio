// @vitest-environment jsdom
/**
 * The picker's "Import from disk", on a frozen workspace.
 *
 * Two things make this control its own case rather than one more greyed button. It renders in a
 * portal on `document.body`, so nothing an opener wraps around its trigger reaches it; and the work
 * it starts is `importLocalAssets`, which opens the file dialog itself and copies every file the
 * author picked into the library before returning. A refusal that waits for the write is a refusal
 * that arrives after the copy.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSelector } from "./AssetSelector";

/** Flipped per case; read by the mocked hook below. */
let frozen = false;
const FREEZE_REASON = "frozen-reason";

const importLocalAssets = vi.fn(async () => ({ success: true as const, data: [] }));

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

// Keys, not prose: what is asserted is which control is off, and English wording is free to change
// without this file having an opinion.
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

// One stub answers every `services.get` the picker makes: the asset library it imports through, and
// the panel state it remembers its expanded folders in.
vi.mock("@/apps/workspace/context", () => {
    const services = {
        get: () => ({
            importLocalAssets,
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
        error: null,
        loadAssets: async () => undefined,
    }),
}));

afterEach(() => {
    cleanup();
    frozen = false;
    importLocalAssets.mockClear();
});

function importButton(): HTMLElement {
    return screen.getByRole("button", { name: "assets.selector.importFromDisk" });
}

function open(): void {
    render(
        <AssetSelector
            visible
            assetType={AssetType.Image}
            onClose={() => undefined}
            onConfirm={() => undefined}
        />,
    );
}

describe("AssetSelector import while the workspace is frozen", () => {
    it("imports when nothing is frozen", async () => {
        open();

        expect(importButton().matches(":disabled")).toBe(false);
        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(importLocalAssets).toHaveBeenCalledTimes(1);
    });

    it("refuses before the file dialog opens", async () => {
        frozen = true;
        open();

        const button = importButton();
        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(button.matches(":disabled")).toBe(true);
        expect(button.getAttribute("data-tip")).toBe(FREEZE_REASON);

        await act(async () => {
            fireEvent.click(button);
        });
        expect(importLocalAssets).not.toHaveBeenCalled();
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
