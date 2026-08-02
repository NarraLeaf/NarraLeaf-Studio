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
    appearanceByCharacterId: {},
    puppetCharacterIds: ["c2", "c3"],
    // Doll's model answered; Ghost's could not be asked (no runtime installed on this machine). The
    // pair is the whole point of the puppet arm: one of them may be marked and the other never may be.
    puppetByCharacterId: {
        c2: {
            motions: ["run", "walk"],
            expressions: ["smile"],
            skins: [],
            params: [{ id: "ParamAngleX", min: -30, max: 30, default: 0 }],
        },
    },
    stageObjects: { image: [], text: [], layer: [], video: [], audio: [], vfx: [] },
} as unknown as StoryCommandContext;

function puppetRow(operation: string, characterId: string, puppetName?: string): StoryBlock {
    return {
        id: "b3",
        parentId: null,
        childrenIds: [],
        kind: "action",
        payload: { action: "character", operation, characterId, ...(puppetName !== undefined ? { puppetName } : {}) },
    } as unknown as StoryBlock;
}

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

    /**
     * A puppet name the model does not have is the second thing that ships a silently wrong game: the
     * compiler forwards the name verbatim (the engine's contract says it must), the build succeeds, and
     * the model simply does not do it.
     */
    describe("a puppet name the model does not have", () => {
        it("marks the row on every channel that carries one", () => {
            expect(diagnoseRow({ block: puppetRow("setMotion", "c2", "runn"), context: CONTEXT })).toEqual({ code: "unknownPuppetName" });
            expect(diagnoseRow({ block: puppetRow("expression", "c2", "grin"), context: CONTEXT })).toEqual({ code: "unknownPuppetName" });
        });

        it("says nothing about a name the model listed", () => {
            expect(diagnoseRow({ block: puppetRow("setMotion", "c2", "walk"), context: CONTEXT })).toBeNull();
        });

        it("says nothing about a blank name - that is the request to clear, not an unfilled slot", () => {
            expect(diagnoseRow({ block: puppetRow("setMotion", "c2"), context: CONTEXT })).toBeNull();
            expect(diagnoseRow({ block: puppetRow("setMotion", "c2", "   "), context: CONTEXT })).toBeNull();
        });

        it("stays quiet on a channel the model said nothing about", () => {
            // Zero skins reported is "no comment", not "no skin is valid" - a skeleton with eleven
            // animations and no skins would otherwise mark every legitimate `/skin` row in the story.
            expect(diagnoseRow({ block: puppetRow("setSkin", "c2", "winter"), context: CONTEXT })).toBeNull();
        });

        it("stays quiet about a model nobody could ask", () => {
            // The name is probably right and it is Studio that cannot check it. Marking here would put
            // a warning on every puppet row of a project opened on a machine without the runtime.
            expect(diagnoseRow({ block: puppetRow("setMotion", "c3", "anything"), context: CONTEXT })).toBeNull();
        });

        it("checks every id on a parameter row, not just the first", () => {
            const row = (params: Record<string, number>): StoryBlock => ({
                id: "b4",
                parentId: null,
                childrenIds: [],
                kind: "action",
                payload: { action: "character", operation: "setParams", characterId: "c2", params },
            } as unknown as StoryBlock);
            expect(diagnoseRow({ block: row({ ParamAngleX: 12 }), context: CONTEXT })).toBeNull();
            expect(diagnoseRow({ block: row({ ParamAngleX: 12, ParamAngleY: 3 }), context: CONTEXT }))
                .toEqual({ code: "unknownPuppetName" });
            expect(diagnoseRow({ block: row({}), context: CONTEXT })).toBeNull();
        });

        it("leaves a character Studio draws itself alone", () => {
            // An `expression` row for a preset character carries a `pose`, not a `puppetName`, so it
            // never reaches the check - but a payload that carries both must not be marked either.
            expect(diagnoseRow({ block: puppetRow("expression", "c1", "smile"), context: CONTEXT })).toBeNull();
        });
    });
});
