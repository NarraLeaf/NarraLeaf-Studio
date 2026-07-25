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

function dialogue(characterId?: string): StoryBlock {
    return {
        id: "b1",
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: {
            action: "dialogue",
            ...(characterId ? { characterId } : {}),
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
    it("leaves a speaker who is not on stage alone", () => {
        // Off-screen voices, phone calls, a character in the next room: normal writing, not a mistake.
        expect(diagnoseRow({ block: dialogue("c1"), context: CONTEXT })).toBeNull();
    });

    it("marks a row pointing at an asset the project no longer has", () => {
        expect(diagnoseRow({ block: background("gone"), context: CONTEXT })).toEqual({ code: "missingAsset" });
    });

    it("says nothing when the asset resolves", () => {
        expect(diagnoseRow({ block: background("i1"), context: CONTEXT })).toBeNull();
    });
});
