// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryScenePreviewController } from "./useStoryScenePreviewController";
import { StoryScenePreviewPane } from "./StoryScenePreviewPane";

vi.mock("@/lib/ui-editor/runtime/game/NlrStageLayer", () => ({ NlrStageLayer: () => null }));
vi.mock("./StoryStageGizmo", () => ({ StoryStageGizmo: () => null }));
vi.mock("./StoryLayerStackView", () => ({ StoryLayerStackView: () => null }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

function pointer(target: Element, type: string, x: number, y: number, relatedTarget?: EventTarget) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, relatedTarget });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
    fireEvent(target, event);
}

describe("the preview stage press", () => {
    it("advances on a click, and discards a press released outside the stage", () => {
        const advanceFromStage = vi.fn();
        const controller = { phase: "settled", stageLayers: [], diagnostics: [], issues: [], advanceFromStage } as unknown as StoryScenePreviewController;
        const { container } = render(<StoryScenePreviewPane controller={controller} onClose={() => undefined} />);
        const stage = container.querySelector("[data-story-preview-stage]")!;

        pointer(stage, "pointerdown", 40, 40);
        pointer(stage, "pointerup", 40, 40);
        expect(advanceFromStage).toHaveBeenCalledTimes(1);

        pointer(stage, "pointerdown", 40, 40);
        pointer(stage, "pointerout", 60, 40, document.body);
        pointer(document.body, "pointerup", 60, 40);
        pointer(document.body, "pointerdown", 60, 40);
        pointer(stage, "pointerup", 40, 40);
        expect(advanceFromStage).toHaveBeenCalledTimes(1);
    });

    it("does not advance when a drag returns to its starting point", () => {
        const advanceFromStage = vi.fn();
        const controller = { phase: "settled", stageLayers: [], diagnostics: [], issues: [], advanceFromStage } as unknown as StoryScenePreviewController;
        const { container } = render(<StoryScenePreviewPane controller={controller} onClose={() => undefined} />);
        const stage = container.querySelector("[data-story-preview-stage]")!;

        pointer(stage, "pointerdown", 40, 40);
        pointer(stage, "pointermove", 60, 40);
        pointer(stage, "pointerup", 40, 40);
        expect(advanceFromStage).not.toHaveBeenCalled();
    });
});
