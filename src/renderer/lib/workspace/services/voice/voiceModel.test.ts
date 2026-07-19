import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { hashSourceText } from "@shared/utils/localizationText";
import type { VoiceDocument } from "@shared/types/voice";
import { VOICE_DOCUMENT_SCHEMA_VERSION } from "@shared/types/voice";
import { computeVoiceProgress, deriveVoiceUnitState, extractVoiceableRows } from "./voiceModel";

function block(partial: Partial<StoryBlock> & Pick<StoryBlock, "id" | "kind" | "payload">): StoryBlock {
    return {
        parentId: null,
        childrenIds: [],
        ...partial,
    } as StoryBlock;
}

function buildDocument(): StoryDocument {
    const blocks: Record<string, StoryBlock> = {
        n1: block({
            id: "n1",
            kind: "nodeAction",
            payload: { action: "narration", text: { textId: "t-n1", value: "The rain kept falling.", role: "narration" } },
        }),
        d1: block({
            id: "d1",
            kind: "nodeAction",
            payload: {
                action: "dialogue",
                characterId: "char-1",
                text: { textId: "t-d1", value: "We should go home.", role: "dialogue" },
            },
        }),
        c1: block({
            id: "c1",
            kind: "nodeAction",
            childrenIds: ["o1"],
            payload: { action: "choice", prompt: { textId: "t-c1", value: "Stay or go?", role: "choicePrompt" } },
        }),
        o1: block({
            id: "o1",
            kind: "nodeAction",
            parentId: "c1",
            payload: { action: "choiceOption", text: { textId: "t-o1", value: "Stay", role: "choiceText" } },
        }),
    };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["scene-a"] }],
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "Scene A",
                runtimeName: "scene_a",
                rootBlockIds: ["n1", "d1", "c1"],
                blocks,
            },
        },
    };
}

function voiceDoc(units: VoiceDocument["units"]): VoiceDocument {
    return { schemaVersion: VOICE_DOCUMENT_SCHEMA_VERSION, locale: "ja", units };
}

describe("extractVoiceableRows", () => {
    it("keeps narration and dialogue, drops choice prompt/text", () => {
        const rows = extractVoiceableRows(buildDocument());
        expect(rows.map(row => row.unitId)).toEqual(["t-n1", "t-d1"]);
        expect(rows.find(row => row.unitId === "t-c1")).toBeUndefined();
        expect(rows.find(row => row.unitId === "t-o1")).toBeUndefined();
    });

    it("carries speaker context on dialogue rows", () => {
        const rows = extractVoiceableRows(buildDocument());
        expect(rows.find(row => row.unitId === "t-d1")?.characterId).toBe("char-1");
    });
});

describe("deriveVoiceUnitState", () => {
    it("returns missing without a unit or asset", () => {
        expect(deriveVoiceUnitState(undefined, "Hi")).toBe("missing");
        expect(deriveVoiceUnitState({ assetId: "", sourceHash: "", status: "linked" }, "Hi")).toBe("missing");
    });

    it("returns linked/approved when the source hash still matches", () => {
        const hash = hashSourceText("Hi");
        expect(deriveVoiceUnitState({ assetId: "a", sourceHash: hash, status: "linked" }, "Hi")).toBe("linked");
        expect(deriveVoiceUnitState({ assetId: "a", sourceHash: hash, status: "approved" }, "Hi")).toBe("approved");
    });

    it("derives stale when the line text changed since import", () => {
        const hash = hashSourceText("Hi");
        expect(deriveVoiceUnitState({ assetId: "a", sourceHash: hash, status: "approved" }, "Hello")).toBe("stale");
    });
});

describe("computeVoiceProgress", () => {
    it("counts covered/approved/stale/missing across the voiceable rows", () => {
        const rows = extractVoiceableRows(buildDocument()).map(row => ({ unitId: row.unitId, sourceText: row.sourceText }));
        // t-n1 approved (current), t-d1 stale (text changed since import).
        const document = voiceDoc({
            "t-n1": { assetId: "a1", sourceHash: hashSourceText("The rain kept falling."), status: "approved" },
            "t-d1": { assetId: "a2", sourceHash: hashSourceText("stale text"), status: "linked" },
        });
        const progress = computeVoiceProgress(rows, document);
        expect(progress).toEqual({ total: 2, covered: 1, approved: 1, stale: 1, missing: 0 });
    });

    it("reports everything missing without a document", () => {
        const rows = extractVoiceableRows(buildDocument()).map(row => ({ unitId: row.unitId, sourceText: row.sourceText }));
        expect(computeVoiceProgress(rows, undefined)).toEqual({ total: 2, covered: 0, approved: 0, stale: 0, missing: 2 });
    });
});
