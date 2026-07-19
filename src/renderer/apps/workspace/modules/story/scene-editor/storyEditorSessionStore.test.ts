import { describe, expect, it } from "vitest";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import {
    getStoryEditorViewState,
    patchStoryEditorViewState,
    type StoryEditorScrollAnchor,
} from "./storyEditorSessionStore";

const anchor = (blockId: string | null): StoryEditorScrollAnchor => ({ blockId, offset: 0, scrollTop: 0 });

/** Minimal in-memory stand-in matching the shallow-merge semantics of PanelStateService. */
function fakePanelState(): PanelStateService {
    const store: Record<string, Record<string, unknown>> = {};
    return {
        getPanelState: (panelId: string) => store[panelId],
        setPanelState: (panelId: string, partial: Record<string, unknown>) => {
            store[panelId] = { ...(store[panelId] ?? {}), ...partial };
        },
    } as unknown as PanelStateService;
}

describe("storyEditorSessionStore view state", () => {
    it("returns undefined for an untouched scene", () => {
        expect(getStoryEditorViewState(fakePanelState(), "scene-untouched")).toBeUndefined();
    });

    it("merges focus and scroll patches without clobbering each other", () => {
        const panelState = fakePanelState();
        const sceneId = "scene-merge";

        // Controller persists the focused row + selection.
        patchStoryEditorViewState(panelState, sceneId, { activeBlockId: "block-1", selectedBlockIds: ["block-1"] });
        // Tab persists the scroll anchor - must not wipe the focus fields.
        patchStoryEditorViewState(panelState, sceneId, { scroll: anchor("block-1") });

        expect(getStoryEditorViewState(panelState, sceneId)).toEqual({
            activeBlockId: "block-1",
            selectedBlockIds: ["block-1"],
            scroll: anchor("block-1"),
        });

        // A later focus change must not wipe the stored scroll anchor.
        patchStoryEditorViewState(panelState, sceneId, { activeBlockId: "block-2", selectedBlockIds: ["block-2"] });
        expect(getStoryEditorViewState(panelState, sceneId)).toEqual({
            activeBlockId: "block-2",
            selectedBlockIds: ["block-2"],
            scroll: anchor("block-1"),
        });
    });

    it("keeps per-scene view states independent", () => {
        const panelState = fakePanelState();
        patchStoryEditorViewState(panelState, "scene-a", { activeBlockId: "a", selectedBlockIds: ["a"] });
        patchStoryEditorViewState(panelState, "scene-b", { activeBlockId: "b", selectedBlockIds: ["b"] });

        expect(getStoryEditorViewState(panelState, "scene-a")?.activeBlockId).toBe("a");
        expect(getStoryEditorViewState(panelState, "scene-b")?.activeBlockId).toBe("b");
    });
});
