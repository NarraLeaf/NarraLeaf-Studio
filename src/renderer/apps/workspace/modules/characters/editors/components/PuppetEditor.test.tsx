// @vitest-environment jsdom
/**
 * "Import a model" on the puppet inspector: through the model import wizard, on a frozen workspace,
 * and when the folder is refused.
 *
 * A model bundle is a directory - a manifest, its textures and its motions - so this is the largest
 * single copy the character editor can start. It goes through the wizard rather than a bare folder
 * picker, because the wizard's scan is what catches a folder one level too high and an export short a
 * texture. The button being grey is not the whole answer: this inspector stays mounted while the
 * author works, and a session opening on the project arms a freeze with no gesture behind it, so the
 * refusal has to sit in front of the wizard rather than behind the copy.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { ModelImportSelection } from "@/apps/workspace/modules/assets/components/ModelImportWizard";
import { PuppetEditor } from "./PuppetEditor";

/** Flipped per case; read by the mocked hook below. */
let frozen = false;
const FREEZE_REASON = "frozen-reason";

const importFromPaths = vi.fn(async (): Promise<unknown> => ({ success: true as const, data: [] }));
const patchAssetExtras = vi.fn(async (): Promise<unknown> => ({ success: true as const, data: {} }));
const showNotification = vi.fn();
const setPuppetAsset = vi.fn();

/** Held identity: the inspector keys two disk reads on the workspace context. */
const stable = vi.hoisted(() => ({
    context: null as unknown,
    /** The wizard's props as the inspector last rendered them. */
    wizard: null as null | {
        visible: boolean;
        family?: string;
        tickLoneModel?: boolean;
        onImport: (selection: ModelImportSelection[]) => void;
        onClose: () => void;
    },
}));

// Keys, not prose: what is asserted is which control is off and which sentence is chosen, and English
// wording is free to change without this file having an opinion. Parameters are appended, so a
// sentence built from another shows what it was built from.
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => (params ? `${key}${JSON.stringify(params)}` : key),
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

vi.mock("@/apps/workspace/context", () => {
    // One stub answers every service the inspector asks for: the library, and the notices.
    stable.context = {
        project: "/proj",
        services: { get: () => ({ getAssets: () => ({}), importFromPaths, patchAssetExtras, showNotification }) },
    };
    return { useWorkspace: () => ({ context: stable.context }) };
});

vi.mock("@/lib/workspace/hooks/useAssetLibraryRevision", () => ({
    useAssetLibraryRevision: () => 0,
}));

// No runtime installed, which is the state an author reaches this surface in before anything else -
// and the one where the inspector offers the import rather than an empty picker.
vi.mock("@/lib/workspace/services/puppet/projectPuppetRuntimes", () => ({
    listProjectPuppetRuntimes: async () => [],
    readPuppetRuntimeInstallState: async () => ({ status: "absent" }),
}));

// The wizard has its own scan and its own pickers; what is pinned here is how the inspector opens it
// and what it does with the folders it hands back.
vi.mock("@/apps/workspace/modules/assets/components/ModelImportWizard", () => ({
    ModelImportWizard: (props: NonNullable<typeof stable.wizard>) => {
        stable.wizard = props;
        return null;
    },
}));

// Two children this case never looks at: one mounts an engine, the other a whole asset browser.
vi.mock("./PuppetPreview", () => ({ PuppetPreview: () => null }));
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({ AssetSelector: () => null }));

function appearanceStub(kind = "live2d"): CharacterAppearance {
    return {
        getPuppet: () => ({ backend: "", assetId: null, entry: null, size: null, options: {} }),
        getPuppetDefaultState: () => ({ motion: null, expression: null, skin: null }),
        getKind: () => kind,
        setPuppetAsset,
        setPuppetBackend: () => undefined,
    } as unknown as CharacterAppearance;
}

afterEach(() => {
    cleanup();
    frozen = false;
    stable.wizard = null;
    importFromPaths.mockClear();
    patchAssetExtras.mockClear();
    showNotification.mockClear();
    setPuppetAsset.mockClear();
});

async function mount(kind?: string): Promise<void> {
    await act(async () => {
        render(<PuppetEditor appearance={appearanceStub(kind)} />);
    });
}

function importButton(): HTMLElement {
    return screen.getByRole("button", { name: "characters.editor.puppet.importModel" });
}

async function clickImport(): Promise<void> {
    await act(async () => {
        fireEvent.click(importButton());
    });
}

const HIYORI: ModelImportSelection = { rootPath: "D:/models/hiyori", entry: "Hiyori.model3.json" };

async function handBack(selection: ModelImportSelection[]): Promise<void> {
    await act(async () => {
        stable.wizard!.onImport(selection);
    });
}

describe("PuppetEditor model import through the wizard", () => {
    it("opens the wizard on the folder picker for this character's runtime, a lone model ticked", async () => {
        await mount("live2d");
        expect(stable.wizard?.visible).toBe(false);

        await clickImport();

        expect(stable.wizard).toMatchObject({ visible: true, family: "live2d", tickLoneModel: true });
    });

    it("opens on the kind step for a custom runtime, which may draw either kind", async () => {
        await mount("puppet");
        await clickImport();

        expect(stable.wizard?.visible).toBe(true);
        expect(stable.wizard?.family).toBeUndefined();
    });

    it("imports the folder the wizard settled on, records its entry, and selects it", async () => {
        importFromPaths.mockImplementationOnce(async () => ({ success: true, data: [{ success: true, data: { id: "model-1", name: "hiyori" } }] }));
        await mount();
        await clickImport();
        await handBack([HIYORI]);

        expect(importFromPaths).toHaveBeenCalledWith("model", ["D:/models/hiyori"]);
        expect(patchAssetExtras).toHaveBeenCalledWith({ id: "model-1", name: "hiyori" }, { modelEntry: "Hiyori.model3.json" });
        expect(showNotification).not.toHaveBeenCalled();
        expect(setPuppetAsset).toHaveBeenCalledWith("model-1");
        expect(stable.wizard?.visible).toBe(false);
    });
});

describe("PuppetEditor model import while the workspace is frozen", () => {
    it("refuses before the wizard opens", async () => {
        frozen = true;
        await mount();

        const button = importButton();
        // `:disabled` rather than `.disabled`: a control switched off by an ancestor `fieldset`
        // reports `.disabled === false`, so the property is the wrong question everywhere.
        expect(button.matches(":disabled")).toBe(true);
        expect(button.getAttribute("data-tip")).toBe(FREEZE_REASON);

        await clickImport();
        expect(stable.wizard?.visible).toBe(false);
    });

    it("still says what this character is missing, which is what a frozen project is for", async () => {
        frozen = true;
        await mount();

        expect(screen.getByText("characters.editor.puppet.noModel")).not.toBeNull();
        expect(screen.getByText("characters.editor.puppet.noModelAssets")).not.toBeNull();
    });
});

describe("PuppetEditor model import that fails", () => {
    it("names a refused folder and says why, instead of leaving the row as it was", async () => {
        importFromPaths.mockImplementationOnce(async () => ({
            success: true,
            // The importer's own sentence names the storage path; only the refusal is shown.
            data: [{ success: false, error: "Failed to copy into D:/game/assets/content/53/22", refusal: { kind: "emptyFolder" } }],
        }));
        await mount();
        await clickImport();
        await handBack([HIYORI]);

        expect(showNotification).toHaveBeenCalledTimes(1);
        const [message, tone] = showNotification.mock.calls[0];
        expect(tone).toBe("error");
        expect(message).toContain("hiyori");
        expect(message).toContain("workspace.shell.import.reason.emptyFolder");
        expect(message).not.toContain("content/53");
        expect(setPuppetAsset).not.toHaveBeenCalled();
    });

    it("says so when the whole import falls over", async () => {
        importFromPaths.mockImplementationOnce(async () => ({ success: false, error: "disk" }));
        await mount();
        await clickImport();
        await handBack([HIYORI]);

        expect(showNotification).toHaveBeenCalledWith("assets.import.failedTitle", "error");
        expect(setPuppetAsset).not.toHaveBeenCalled();
    });
});
