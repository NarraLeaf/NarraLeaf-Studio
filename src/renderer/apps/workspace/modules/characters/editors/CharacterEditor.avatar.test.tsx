// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterEditor } from "./CharacterEditor";

const state = vi.hoisted(() => {
    const ui = { editor: { promote: vi.fn() }, getStore: () => ({ updateEditorTab: vi.fn() }) };
    const panel = { getPanelState: () => undefined, setPanelState: vi.fn() };
    return { context: { services: { get: (key: string) => key === "ui" ? ui : panel } } };
});

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: state.context, isInitialized: true }),
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ frozen: false, reason: "", writes: () => ({}) }),
}));
vi.mock("@/lib/i18n", async original => ({
    ...(await original<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/apps/workspace/modules/assets/state/useAssetSetPickerSource", () => ({
    useAssetSetPickerSource: () => ({}),
}));
vi.mock("@/lib/workspace/hooks/usePosePictureSizes", () => ({ usePosePictureSizes: () => ({}) }));
vi.mock("../useCharacterAvatarBake", () => ({
    useCharacterAvatarBake: () => ({ rebake: async () => undefined, running: false, summary: null }),
}));
vi.mock("../useAvatarAutoFrame", () => ({ useAvatarAutoFrame: () => ({ running: false, frameOne: async () => false }) }));
vi.mock("./components/AvatarSection", () => ({
    AvatarSection: (props: { onPickOverride: (element: HTMLElement) => void; onClearOverride: () => void; onToggleCropping: () => void; onResetCrop: () => void }) => (
        <>
            <button onClick={event => props.onPickOverride(event.currentTarget)}>Pick avatar</button>
            <button onClick={props.onClearOverride}>Clear avatar</button>
            <button onClick={props.onToggleCropping}>Crop avatar</button>
            <button onClick={props.onResetCrop}>Reset crop</button>
        </>
    ),
}));
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({
    AssetSelector: (props: { visible: boolean; onConfirm: (assets: { id: string }[]) => void }) => props.visible
        ? <button onClick={() => props.onConfirm([{ id: "hand-drawn" }])}>Choose image</button>
        : null,
}));
vi.mock("./components/CharacterPosePreview", () => ({ CharacterPosePreview: ({ overlay }: { overlay: React.ReactNode }) => overlay }));
vi.mock("./components/FrameSequenceEditor", () => ({ FrameSequenceEditor: () => null }));
vi.mock("./components/PoseFilmstrip", () => ({ PoseFilmstrip: () => null }));
vi.mock("./components/PsdImportWizard", () => ({ PsdImportWizard: () => null }));
vi.mock("@/apps/workspace/components/layout/EditorProjectUndoKeybindings", () => ({ EditorProjectUndoKeybindings: () => null }));

afterEach(cleanup);

describe("the avatar override in CharacterEditor", () => {
    it("keeps the differential's framing when an override is chosen and cleared", () => {
        const portrait = { x: 0.2, y: 0.1, w: 0.3, h: 0.3 };
        const character = Character.fromJSON({
            profile: {
                id: "c1", name: "Narra", description: "", tags: [], attributes: {}, nicknames: [], thumbnail: null,
                appearance: {
                    kind: "preset", defaultPoseId: "p1", poses: [{ id: "p1", name: "Default", assetId: "a1" }],
                    avatars: { p1: { portrait, baked: "previous-bake" } },
                },
            },
        } as never);
        render(<CharacterEditor tabId="character-c1" active payload={{ character }} />);

        fireEvent.click(screen.getByText("Pick avatar"));
        fireEvent.click(screen.getByText("Choose image"));
        expect(character.profile.appearance.getAvatar("p1")).toEqual({ portrait, baked: "previous-bake", overrideAssetId: "hand-drawn" });

        fireEvent.click(screen.getByText("Clear avatar"));
        expect(character.profile.appearance.getAvatar("p1")).toEqual({ portrait, baked: "previous-bake" });
    });

    it("removes the character-wide crop from the serialized profile on reset", () => {
        const portrait = { x: 0.2, y: 0.1, w: 0.3, h: 0.3 };
        const character = Character.fromJSON({
            profile: {
                id: "c1", name: "Narra", description: "", tags: [], attributes: {}, nicknames: [], thumbnail: null,
                portrait,
                appearance: { kind: "preset", defaultPoseId: "p1", poses: [{ id: "p1", name: "Default", assetId: "a1" }], avatars: {} },
            },
        } as never);
        render(<CharacterEditor tabId="character-c1" active payload={{ character }} />);
        fireEvent.click(screen.getByText("Reset crop"));
        expect(character.toJSON().profile).not.toHaveProperty("portrait");
    });
});
