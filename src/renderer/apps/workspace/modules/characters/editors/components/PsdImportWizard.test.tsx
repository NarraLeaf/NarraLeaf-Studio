// @vitest-environment jsdom
/**
 * The PSD wizard on a workspace that froze while it was open.
 *
 * Its opener in the character editor is greyed by the freeze, but that decision was made on a render
 * that happened before the author started reading a fifty-layer tree - and a session opening on the
 * project arms a freeze with no gesture behind it at all. Import bakes every layer to disk and copies
 * each one into the library, so the refusal has to arrive before the bake rather than after it.
 *
 * Reading a PSD stays available while frozen: that is inspection, and the mapping is what the author
 * came to look at.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { PsdDocument } from "@shared/types/psdImport";
import { PsdImportWizard } from "./PsdImportWizard";

/** Flipped per case; read by the mocked hook below. */
let frozen = false;
const FREEZE_REASON = "frozen-reason";

const bakePsd = vi.fn(async () => ({
    success: true as const,
    data: { layers: [{ path: ["base"], filePath: "/tmp/base.png" }] },
}));
const importFromPaths = vi.fn(async () => ({
    success: true as const,
    data: [{ success: true as const, data: { id: "asset-base" } }],
}));

// Keys, not prose: what is asserted is which control is off, and English wording is free to change
// without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, locale: "en" }),
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
    getInterface: () => ({
        openPsd: async () => ({ success: true, data: { filePath: "/art/hero.psd", document: DOCUMENT } }),
        bakePsd,
    }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => ({ importFromPaths }) } } }),
}));

/** Two plain layers: no unsupported blend mode, so nothing is left undecided and Import is offered. */
const DOCUMENT: PsdDocument = {
    width: 1000,
    height: 2000,
    fileName: "hero.psd",
    layers: [
        {
            path: ["base"],
            name: "base",
            bounds: { left: 0, top: 0, right: 500, bottom: 900 },
            blendMode: "normal",
            opacity: 1,
            hidden: false,
            clipping: false,
        },
    ],
};

/** Enough of an appearance for the plan to be summarised and, when it runs, applied. */
function appearanceStub(): CharacterAppearance {
    return {
        findPsdSlot: () => null,
        createLayer: (name: string) => ({ id: `layer-${name}` }),
        setLayerAsset: () => undefined,
        getCanvas: () => null,
        setCanvas: () => undefined,
        getPsdFingerprint: () => null,
        setPsdFingerprint: () => undefined,
    } as unknown as CharacterAppearance;
}

afterEach(() => {
    cleanup();
    frozen = false;
    bakePsd.mockClear();
    importFromPaths.mockClear();
});

/** Open the wizard and read a PSD, the way the author does before deciding anything. */
async function openWithDocument(): Promise<ReturnType<typeof render>> {
    const view = render(
        <PsdImportWizard open onClose={() => undefined} appearance={appearanceStub()} characterName="Hero" />,
    );
    await act(async () => {
        fireEvent.click(screen.getByText("characters.editor.psd.choose"));
    });
    return view;
}

function importButton(): HTMLElement {
    return screen.getByRole("button", { name: "characters.editor.psd.import" });
}

describe("PsdImportWizard while the workspace is frozen", () => {
    it("bakes and imports when nothing is frozen", async () => {
        await openWithDocument();

        expect(importButton().matches(":disabled")).toBe(false);
        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(bakePsd).toHaveBeenCalledTimes(1);
        expect(importFromPaths).toHaveBeenCalledTimes(1);
    });

    it("refuses before the bake when the freeze arrives with the wizard open", async () => {
        const view = await openWithDocument();

        // The freeze arms mid-conversation, exactly as a session starting on this project would.
        frozen = true;
        view.rerender(
            <PsdImportWizard open onClose={() => undefined} appearance={appearanceStub()} characterName="Hero" />,
        );

        const button = importButton();
        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(button.matches(":disabled")).toBe(true);
        expect(button.getAttribute("data-tip")).toBe(FREEZE_REASON);

        await act(async () => {
            fireEvent.click(button);
        });
        // Not one layer written, not one file copied: the refusal is ahead of both.
        expect(bakePsd).not.toHaveBeenCalled();
        expect(importFromPaths).not.toHaveBeenCalled();
    });

    it("keeps the mapping readable, which is what a frozen project is for", async () => {
        frozen = true;
        await openWithDocument();

        expect(screen.getByText("hero.psd")).not.toBeNull();
        expect(document.querySelector('[data-psd-constant="base"]')).not.toBeNull();
    });
});
