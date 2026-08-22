// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import { story as en } from "@shared/i18n/catalog/en/story";
import { makeFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { StorySceneOverviewBlock } from "./StorySceneEditorTab";

/**
 * The card above the rows, while a live session owns the story.
 *
 * Its controls all commit through `updateSceneMetadata`, which is `StoryService.updateScene` - not
 * one of the operations a session hands to its sink, and every field it writes is part of what the
 * machines in a room fingerprint. So a name typed here during a session would be written on this
 * machine alone, and the next effect about the scene would eject this window from the room.
 *
 * The name and the description are checked through `readOnly` rather than `:disabled`: they are the
 * two fields whose text is worth reading and selecting while it cannot be changed, so they are left
 * enabled and made uneditable. The picker and the clear button are real buttons and answer
 * `:disabled`.
 */

const IN_A_SESSION = en.live.editUnavailable;

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null, isInitialized: false }),
}));

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, loading: false, error: undefined }),
}));

vi.mock("@/apps/workspace/modules/assets/state/useAssetSetPickerSource", () => ({
    useAssetSetPickerSource: () => ({ virtualGroups: undefined, resolveAssetPreviewUrl: undefined }),
}));

// A modal that reads the asset library. Nothing under test opens it, and mounting it would drag the
// whole picker in behind it.
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({
    AssetSelector: () => null,
}));

const scene = {
    id: "scene-1",
    name: "Rooftop",
    description: "Ten at night.",
    rootBlockIds: [],
    blocks: {},
} as unknown as StoryScene;

const document = { id: "chapter-one", name: "Story", scenes: { "scene-1": scene } } as unknown as StoryDocument;

/**
 * The card's controls, in the order they appear: the fold, the big backdrop plate, the backdrop
 * picker beside the label, and the button that clears it.
 *
 * Read positionally rather than by text: three of them show the same "No background" phrase, which
 * is the point of the plate and the picker being two ways to the same choice.
 */
function renderCard(owned: boolean) {
    const onUpdateScene = vi.fn(() => true);
    const { container } = render(
        <StorySceneOverviewBlock
            document={document}
            scene={scene}
            backgroundAsset={null}
            onUpdateScene={onUpdateScene}
            panelStateService={null}
            liveSession={makeFreezeGuard(owned, IN_A_SESSION)}
        />,
    );
    const buttons = [...container.querySelectorAll("button")];
    return {
        onUpdateScene,
        name: container.querySelector("input") as HTMLInputElement,
        description: container.querySelector("textarea") as HTMLTextAreaElement,
        plate: buttons[1],
        picker: buttons[2],
        clear: buttons[3],
    };
}

afterEach(cleanup);

describe("the scene overview card inside a session on this story", () => {
    it("leaves the name and the description readable and refuses to change them", () => {
        const card = renderCard(true);

        expect(card.name.readOnly).toBe(true);
        expect(card.name.getAttribute("data-tip")).toBe(IN_A_SESSION);
        expect(card.description.readOnly).toBe(true);
        expect(card.description.getAttribute("data-tip")).toBe(IN_A_SESSION);
        // Disabled, not hidden: the scene's own name is exactly what an author wants to read here.
        expect(card.name.value).toBe("Rooftop");
        expect(card.description.value).toBe("Ten at night.");
    });

    it("switches the backdrop controls off with the reason on them", () => {
        const card = renderCard(true);

        expect(card.plate.matches(":disabled")).toBe(true);
        expect(card.plate.getAttribute("data-tip")).toBe(IN_A_SESSION);
        expect(card.picker.matches(":disabled")).toBe(true);
        expect(card.picker.getAttribute("data-tip")).toBe(IN_A_SESSION);

        fireEvent.click(card.plate);
        fireEvent.click(card.picker);
        expect(card.onUpdateScene).not.toHaveBeenCalled();
    });
});

describe("the scene overview card with no session on this story", () => {
    it("keeps every control live", () => {
        const card = renderCard(false);

        expect(card.name.readOnly).toBe(false);
        expect(card.name.getAttribute("data-tip")).toBeNull();
        expect(card.description.readOnly).toBe(false);
        expect(card.plate.matches(":disabled")).toBe(false);
        expect(card.picker.matches(":disabled")).toBe(false);
        // Still off for its own reason - there is no backdrop to clear - and the session is not
        // allowed to claim that as its doing.
        expect(card.clear.matches(":disabled")).toBe(true);
        expect(card.clear.getAttribute("data-tip")).toBe(en.sceneEditor.clearBackground);
    });

    it("still writes a renamed scene through", () => {
        const card = renderCard(false);

        fireEvent.change(card.name, { target: { value: "Rooftop, later" } });
        fireEvent.blur(card.name);

        expect(card.onUpdateScene).toHaveBeenCalledWith({ name: "Rooftop, later" });
    });
});
