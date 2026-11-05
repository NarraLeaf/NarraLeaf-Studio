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
 *
 * And a re-import of the same sheet writes each layer into the image the last import made, rather
 * than leaving a second copy of every layer in the library - having copied the image's current pixels
 * aside first, so the import's undo step can put them back. The step itself and the bytes coming back
 * are `CharacterService.recordEdit.test.ts` and `AssetsService.libraryChange.test.ts`.
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
// The image section's folders: none yet, so the import makes the character's.
const createGroup = vi.fn(async (_category: string, name: string) => ({
    success: true as const,
    data: { id: `folder-${name}`, name },
}));
const moveAssetsToGroup = vi.fn(async () => ({ success: true as const, data: undefined }));
/** The image section of the library, by id: empty until a case puts the last import's image in it. */
let images: Record<string, { id: string; name: string }> = {};
const replaceAssetContent = vi.fn(async (asset: { id: string }) => ({ success: true as const, data: asset }));
/** What `keep` answers in a case; every copy is made unless a case says otherwise. */
let keepAnswer: { ok: true } | { ok: false; name: string; refusal: { kind: "notKept"; fsCode?: string } } = { ok: true };
/** What the import did to the library, as the wizard reported it. */
const change = {
    keep: vi.fn(async (_assets: unknown[]) => keepAnswer),
    replaced: vi.fn(),
    forget: vi.fn(),
    noteImported: vi.fn(),
    noteCreatedFolder: vi.fn(),
    undo: vi.fn(async () => undefined),
    dispose: vi.fn(),
};
/** The image section's folders as the import finds them: none unless a case puts one there. */
let folders: { id: string; name: string }[] = [];
const assetsService = {
    importFromPaths,
    getAssets: () => ({ image: images }),
    replaceAssetContent,
    beginLibraryChange: () => change,
    getGroupAssetsManager: () => ({ getGroups: () => folders }),
    createGroup,
    moveAssetsToGroup,
};
const characterRecord = { profile: { id: "hero", name: "Hero" } };
const recordCharacterEdit = vi.fn(() => true);
const characterService = {
    getCharacter: (id: string) => (id === "hero" ? { toJSON: () => characterRecord } : undefined),
    recordCharacterEdit,
};

// Keys, not prose: what is asserted is which control is off, and English wording is free to change
// without this file having an opinion.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, locale: "en" }),
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
    useWorkspace: () => ({
        context: { services: { get: (id: string) => (id === "character" ? characterService : assetsService) } },
    }),
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

/**
 * Enough of an appearance for the plan to be summarised and, when it runs, applied. `imported` is
 * one the same sheet was imported into before: its base layer shows the image that import made.
 */
function appearanceStub(imported = false): CharacterAppearance {
    const layer = { id: "layer-base", name: "base", axisId: null, assetId: "asset-base" };
    return {
        findPsdSlot: () => (imported ? { layerId: layer.id } : null),
        getLayer: () => (imported ? layer : null),
        getLayers: () => (imported ? [layer] : []),
        createLayer: (name: string) => ({ id: `layer-${name}` }),
        setLayerAsset: () => undefined,
        getCanvas: () => null,
        setCanvas: () => undefined,
        getPsdFingerprint: () => (imported
            ? { fileName: "hero.psd", width: 1000, height: 2000, importedAt: 1, slots: [{ path: ["base"], layerId: layer.id, assetId: layer.assetId }] }
            : null),
        setPsdFingerprint: () => undefined,
    } as unknown as CharacterAppearance;
}

afterEach(() => {
    cleanup();
    frozen = false;
    images = {};
    folders = [];
    keepAnswer = { ok: true };
    Object.values(change).forEach(spy => spy.mockClear());
    recordCharacterEdit.mockClear();
    replaceAssetContent.mockClear();
    bakePsd.mockClear();
    importFromPaths.mockClear();
    createGroup.mockClear();
    moveAssetsToGroup.mockClear();
});

/** Open the wizard and read a PSD, the way the author does before deciding anything. */
async function openWithDocument(onImported?: (hadArt: boolean) => void, imported = false): Promise<ReturnType<typeof render>> {
    const view = render(
        <PsdImportWizard open onClose={() => undefined} characterId="hero" appearance={appearanceStub(imported)} characterName="Hero" onImported={onImported} />,
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
        const onImported = vi.fn();
        await openWithDocument(onImported);

        expect(importButton().matches(":disabled")).toBe(false);
        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(bakePsd).toHaveBeenCalledTimes(1);
        expect(importFromPaths).toHaveBeenCalledTimes(1);
        // Filed in the image folder named after the character, not left in the section's root.
        expect(createGroup).toHaveBeenCalledWith("image", "Hero");
        expect(moveAssetsToGroup).toHaveBeenCalledWith([{ id: "asset-base" }], "folder-Hero");
        // A character with no art before it: the editor stands her first picture on the floor.
        expect(onImported).toHaveBeenCalledWith(false);
    });

    it("refuses before the bake when the freeze arrives with the wizard open", async () => {
        const view = await openWithDocument();

        // The freeze arms mid-conversation, exactly as a session starting on this project would.
        frozen = true;
        view.rerender(
            <PsdImportWizard open onClose={() => undefined} characterId="hero" appearance={appearanceStub()} characterName="Hero" />,
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

describe("PsdImportWizard and the character's image folder", () => {
    it("hands the folder it made to the import's undo step, which takes it back once the layers are out", async () => {
        await openWithDocument();

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(createGroup).toHaveBeenCalledWith("image", "Hero");
        expect(change.noteCreatedFolder).toHaveBeenCalledWith("image", "folder-Hero");
        expect(recordCharacterEdit).toHaveBeenCalledWith("hero", characterRecord, { key: "workspace.history.entry.importPsd" }, change);
    });

    it("leaves a folder that was already there out of the step, so no undo takes it", async () => {
        folders = [{ id: "hero-art", name: "Hero" }];
        await openWithDocument();

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(createGroup).not.toHaveBeenCalled();
        expect(moveAssetsToGroup).toHaveBeenCalledWith([{ id: "asset-base" }], "hero-art");
        expect(change.noteCreatedFolder).not.toHaveBeenCalled();
    });
});

describe("PsdImportWizard importing a sheet again", () => {
    it("writes each layer into the image the last import made, and imports no second copy", async () => {
        images = { "asset-base": { id: "asset-base", name: "Hero_base.png" } };
        await openWithDocument(undefined, true);

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(replaceAssetContent).toHaveBeenCalledWith(images["asset-base"], "/tmp/base.png");
        expect(importFromPaths).not.toHaveBeenCalled();
        // The refreshed image stays where it is; nothing new needs filing.
        expect(moveAssetsToGroup).not.toHaveBeenCalled();
    });

    it("copies the image's pixels aside before writing over them, and leaves one step that owns the copy", async () => {
        images = { "asset-base": { id: "asset-base", name: "Hero_base.png" } };
        await openWithDocument(undefined, true);

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(change.keep).toHaveBeenCalledWith([images["asset-base"]]);
        expect(change.keep.mock.invocationCallOrder[0]).toBeLessThan(replaceAssetContent.mock.invocationCallOrder[0]);
        expect(change.replaced).toHaveBeenCalledWith("asset-base");
        // One step, from the character as it was before the import, carrying the library's half.
        expect(recordCharacterEdit).toHaveBeenCalledTimes(1);
        expect(recordCharacterEdit).toHaveBeenCalledWith(
            "hero",
            characterRecord,
            { key: "workspace.history.entry.importPsd" },
            change,
        );
        // The step owns the copy now: the wizard neither takes it back nor lets it go.
        expect(change.undo).not.toHaveBeenCalled();
        expect(change.dispose).not.toHaveBeenCalled();
    });

    it("writes over nothing when the image's pixels cannot be copied aside", async () => {
        images = { "asset-base": { id: "asset-base", name: "Hero_base.png" } };
        keepAnswer = { ok: false, name: "Hero_base.png", refusal: { kind: "notKept", fsCode: "NO_SPACE" } };
        await openWithDocument(undefined, true);

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(replaceAssetContent).not.toHaveBeenCalled();
        expect(importFromPaths).not.toHaveBeenCalled();
        expect(recordCharacterEdit).not.toHaveBeenCalled();
        // Said in the wizard, by the image and why.
        expect(screen.getByText("assets.reference.withReason")).not.toBeNull();
    });

    it("imports the layer as a file of its own when the image cannot be written in place", async () => {
        images = { "asset-base": { id: "asset-base", name: "Hero_base.png" } };
        replaceAssetContent.mockImplementationOnce(async () => ({ success: false, error: "in a session" }) as never);
        await openWithDocument(undefined, true);

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(replaceAssetContent).toHaveBeenCalledTimes(1);
        expect(importFromPaths).toHaveBeenCalledWith("image", ["/tmp/base.png"]);
        // The copy made for a write that did not happen goes; the new file is the step's to take back.
        expect(change.forget).toHaveBeenCalledWith("asset-base");
        expect(change.noteImported).toHaveBeenCalledWith([{ id: "asset-base" }]);
    });

    it("takes back what it had written when the import fails after the refresh", async () => {
        images = { "asset-base": { id: "asset-base", name: "Hero_base.png" } };
        // The sheet grew a layer: the base is refreshed in place, the new one has to be imported.
        bakePsd.mockImplementationOnce(async () => ({
            success: true as const,
            data: { layers: [{ path: ["base"], filePath: "/tmp/base.png" }, { path: ["extra"], filePath: "/tmp/extra.png" }] },
        }));
        importFromPaths.mockImplementationOnce(async () => ({ success: false, error: "disk" }) as never);
        await openWithDocument(undefined, true);

        await act(async () => {
            fireEvent.click(importButton());
        });
        expect(replaceAssetContent).toHaveBeenCalledTimes(1);
        expect(change.replaced).toHaveBeenCalledWith("asset-base");
        expect(recordCharacterEdit).not.toHaveBeenCalled();
        // Whatever it had written is taken back, and what it held is let go.
        expect(change.undo).toHaveBeenCalledTimes(1);
        expect(change.dispose).toHaveBeenCalledTimes(1);
    });
});
