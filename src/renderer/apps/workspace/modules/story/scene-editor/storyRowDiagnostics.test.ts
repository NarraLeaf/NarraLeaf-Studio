import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import type { StoryCommandContext } from "./storyCommandResolution";
import { diagnoseRow } from "./storyRowDiagnostics";

const CONTEXT = {
    images: [{ id: "i1", name: "forest_day" }],
    audio: [{ id: "a1", name: "theme" }],
    videos: [{ id: "v1", name: "intro" }],
    characters: [{ id: "c1", name: "Alice" }],
    tempSpeakers: [],
    scenes: [],
    labels: [],
    variables: [],
    formsByCharacterId: {},
    stageObjects: { image: [], text: [], layer: [], video: [], audio: [], vfx: [] },
} as unknown as StoryCommandContext;

function dialogue(characterId?: string, speakerName?: string): StoryBlock {
    return {
        id: "b1",
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: {
            action: "dialogue",
            ...(characterId ? { characterId } : {}),
            ...(speakerName ? { speakerName } : {}),
            text: { textId: "t1", role: "dialogue", value: "Hello" },
        },
    } as StoryBlock;
}

function background(assetId: string): StoryBlock {
    return {
        id: "b2",
        parentId: null,
        childrenIds: [],
        kind: "action",
        payload: { action: "setBackground", assetId },
    } as StoryBlock;
}

describe("diagnoseRow", () => {
    it("marks a character who speaks without ever being shown", () => {
        expect(diagnoseRow({ block: dialogue("c1"), context: CONTEXT })).toEqual({ code: "speakerNotShown" });
    });

    it("says nothing once the character is on stage", () => {
        expect(diagnoseRow({ block: dialogue("c1"), appearance: { shown: true }, context: CONTEXT })).toBeNull();
    });

    it("does not count a placement move as an entrance", () => {
        // `/move` on a hidden character is a runtime no-op, so it must not clear the warning.
        expect(diagnoseRow({ block: dialogue("c1"), appearance: { positionSourceId: "x" }, context: CONTEXT }))
            .toEqual({ code: "speakerNotShown" });
    });

    it("leaves a bare-name speaker alone", () => {
        // There is no character to show, so there is nothing to have forgotten.
        expect(diagnoseRow({ block: dialogue(undefined, "Zoe"), context: CONTEXT })).toBeNull();
    });

    it("marks a row pointing at an asset the project no longer has", () => {
        expect(diagnoseRow({ block: background("gone"), context: CONTEXT })).toEqual({ code: "missingAsset" });
    });

    it("says nothing when the asset resolves", () => {
        expect(diagnoseRow({ block: background("i1"), context: CONTEXT })).toBeNull();
    });
});
