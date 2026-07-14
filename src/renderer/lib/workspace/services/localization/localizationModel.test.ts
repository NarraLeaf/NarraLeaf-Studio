import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import { hashSourceText } from "@shared/utils/localizationText";
import type { LocalizationDocument } from "@shared/types/localization";
import { LOCALIZATION_DOCUMENT_SCHEMA_VERSION } from "@shared/types/localization";
import {
    computeLocalizationProgress,
    deriveUnitState,
    extractCharacterTranslationRows,
    extractStoryTranslationRows,
} from "./localizationModel";

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
            childrenIds: ["o1", "o2"],
            payload: { action: "choice", prompt: { textId: "t-c1", value: "Stay or go?", role: "choicePrompt" } },
        }),
        o1: block({
            id: "o1",
            kind: "nodeAction",
            parentId: "c1",
            payload: { action: "choiceOption", text: { textId: "t-o1", value: "Stay", role: "choiceText" } },
        }),
        o2: block({
            id: "o2",
            kind: "nodeAction",
            parentId: "c1",
            payload: { action: "choiceOption", text: { textId: "t-o2", value: "", role: "choiceText" } },
        }),
        note1: block({
            id: "note1",
            kind: "note",
            payload: { text: { textId: "t-note", value: "editor-only note", role: "note" } },
        }),
    };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [
            { id: "ch-1", name: "Chapter 1", sceneIds: ["scene-b"] },
        ],
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "Unassigned scene",
                runtimeName: "scene_a",
                rootBlockIds: ["n1"],
                blocks: { n1: blocks.n1 },
            },
            "scene-b": {
                id: "scene-b",
                name: "Chapter scene",
                runtimeName: "scene_b",
                rootBlockIds: ["d1", "c1", "note1"],
                blocks,
            },
        },
    };
}

describe("extractStoryTranslationRows", () => {
    it("walks chapters first, then unassigned scenes, depth-first inside scenes", () => {
        const rows = extractStoryTranslationRows(buildDocument());
        expect(rows.map(row => row.unitId)).toEqual(["t-d1", "t-c1", "t-o1", "t-n1"]);
    });

    it("skips empty segments and editor notes, keeps character context", () => {
        const rows = extractStoryTranslationRows(buildDocument());
        expect(rows.find(row => row.unitId === "t-o2")).toBeUndefined();
        expect(rows.find(row => row.unitId === "t-note")).toBeUndefined();
        const dialogue = rows.find(row => row.unitId === "t-d1");
        expect(dialogue?.characterId).toBe("char-1");
        expect(dialogue?.sceneName).toBe("Chapter scene");
        expect(dialogue?.sourceText).toBe("We should go home.");
    });
});

describe("extractCharacterTranslationRows", () => {
    it("maps characters to char:<id> units sorted by name", () => {
        const rows = extractCharacterTranslationRows([
            { id: "c-2", name: "Yuki" },
            { id: "c-1", name: "Aoi" },
        ]);
        expect(rows).toEqual([
            { unitId: "char:c-1", characterId: "c-1", sourceText: "Aoi" },
            { unitId: "char:c-2", characterId: "c-2", sourceText: "Yuki" },
        ]);
    });

    it("skips characters without a display name", () => {
        const rows = extractCharacterTranslationRows([
            { id: "c-1", name: "" },
            { id: "c-2", name: "   " },
            { id: "c-3", name: "Mio" },
        ]);
        expect(rows.map(row => row.unitId)).toEqual(["char:c-3"]);
    });
});

describe("deriveUnitState", () => {
    const sourceText = "We should go home.";

    it("is untranslated without a unit or with an empty target", () => {
        expect(deriveUnitState(undefined, sourceText)).toBe("untranslated");
        expect(deriveUnitState({ target: "", sourceHash: hashSourceText(sourceText), status: "translated" }, sourceText)).toBe("untranslated");
    });

    it("is stale when the source changed after translation", () => {
        const unit = { target: "早く帰ろう。", sourceHash: hashSourceText("Old line"), status: "translated" as const };
        expect(deriveUnitState(unit, sourceText)).toBe("stale");
    });

    it("reflects the stored status when the hash matches", () => {
        const unit = { target: "早く帰ろう。", sourceHash: hashSourceText(sourceText), status: "reviewed" as const };
        expect(deriveUnitState(unit, sourceText)).toBe("reviewed");
    });
});

describe("computeLocalizationProgress", () => {
    it("buckets rows into completed / stale / untranslated", () => {
        const rows = extractStoryTranslationRows(buildDocument());
        const document: LocalizationDocument = {
            schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
            locale: "ja",
            units: {
                "t-d1": { target: "早く帰ろう。", sourceHash: hashSourceText("We should go home."), status: "translated" },
                "t-c1": { target: "古い訳", sourceHash: hashSourceText("old prompt"), status: "translated" },
                "t-o1": { target: "残る", sourceHash: hashSourceText("Stay"), status: "reviewed" },
            },
        };
        expect(computeLocalizationProgress(rows, document)).toEqual({
            total: 4,
            completed: 2,
            reviewed: 1,
            machine: 0,
            stale: 1,
            untranslated: 1,
        });
    });
});
