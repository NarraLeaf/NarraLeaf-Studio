// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryAnimationAsset, StoryAnimationIndex } from "@shared/types/story";
import { MotionField } from "./MotionSelector";

const services = vi.hoisted(() => {
    let listener: ((index: StoryAnimationIndex) => void) | undefined;
    let asset = { id: "motion", name: "Original" } as StoryAnimationAsset;
    const story = {
        loadAnimationAsset: vi.fn(async () => asset),
        onAnimationsChanged: vi.fn((handler: (index: StoryAnimationIndex) => void) => {
            listener = handler;
            return () => { listener = undefined; };
        }),
    };
    return {
        story,
        respond(promise: Promise<StoryAnimationAsset>) { story.loadAnimationAsset.mockImplementationOnce(() => promise); },
        changed() { listener?.({ animations: [] } as unknown as StoryAnimationIndex); },
        rename(name: string) {
            asset = { ...asset, name };
            listener?.({ animations: [] } as unknown as StoryAnimationIndex);
        },
        reset() {
            asset = { id: "motion", name: "Original" } as StoryAnimationAsset;
            listener = undefined;
        },
    };
});

vi.mock("../../context", () => ({
    useWorkspace: () => ({ context: { services: { get: () => services.story } }, isInitialized: true }),
}));
vi.mock("../../registry", () => ({ useRegistry: () => ({ openEditorTab: vi.fn() }) }));
vi.mock("@/lib/components/layout", () => ({ useFloatingLayer: () => undefined, useHostDocument: () => document }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({ useAssetObjectUrl: () => ({ url: null }) }));
vi.mock("./StoryMotionEditorTab", () => ({ createStoryMotionEditorTab: () => ({}), resolveStoryMotionStageSize: () => ({ width: 1280, height: 720 }) }));
vi.mock("./StoryMotionLoopPreview", () => ({ StoryMotionLoopPreview: () => null }));
vi.mock("./StoryMotionPresetGallery", () => ({ StoryMotionPresetGallery: () => null }));

afterEach(() => { cleanup(); services.reset(); });

describe("MotionField", () => {
    it("refreshes the bound name after the motion is renamed", async () => {
        render(<MotionField
            value={{ mode: "animation", animationId: "motion" }}
            targetKind="image"
            motionLabel="Image"
            actionContext={{ storyId: "story", sceneId: "scene", blockId: "row" }}
            onChange={() => undefined}
        />);
        await screen.findByText("Original");
        services.rename("Renamed");
        await waitFor(() => expect(screen.getByText("Renamed")).toBeTruthy());
    });

    it("keeps the newest asset when an older refresh finishes later", async () => {
        render(<MotionField
            value={{ mode: "animation", animationId: "motion" }}
            targetKind="image"
            motionLabel="Image"
            actionContext={{ storyId: "story", sceneId: "scene", blockId: "row" }}
            onChange={() => undefined}
        />);
        await screen.findByText("Original");
        let finish!: (asset: StoryAnimationAsset) => void;
        services.respond(new Promise(resolve => { finish = resolve; }));
        services.changed();
        services.rename("Renamed");
        await screen.findByText("Renamed");
        finish({ id: "motion", name: "Old response" } as StoryAnimationAsset);
        await waitFor(() => expect(screen.getByText("Renamed")).toBeTruthy());
        expect(screen.queryByText("Old response")).toBeNull();
    });
});
