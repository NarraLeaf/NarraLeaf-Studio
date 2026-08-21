import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { normalizeDictionaryEntries } from "@shared/types/dictionary";
import { findInStoryDocument, findingsByTerm, variantNeedles } from "./dictionaryScan";

/**
 * Reading a whole story against the dictionary.
 *
 * The same matcher the open row uses, so what is pinned here is what the *project* pass adds: which
 * rows it looks at, what it puts in a finding, and that a row already annotated by hand is not a
 * finding at all.
 */

function dialogue(id: string, text: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "dialogue", text: { value: text, textId: `t-${id}`, role: "dialogue" } },
    } as StoryBlock;
}

function storyDoc(): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Main Story",
        entrySceneId: "scene-1",
        chapters: [{ id: "ch-1", name: "Chapter 1", sceneIds: ["scene-1"] }],
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Opening",
                runtimeName: "opening",
                rootBlockIds: ["b1", "b2", "b3", "b4", "v1"],
                blocks: {
                    b1: dialogue("b1", "The colour of the sky."),
                    // Two in one row: both are found, in the order they are written.
                    b2: dialogue("b2", "Colour, and colour again."),
                    b3: dialogue("b3", "The color of the sky."),
                    b4: {
                        id: "b4",
                        kind: "jump",
                        parentId: null,
                        childrenIds: [],
                        payload: {},
                    } as unknown as StoryBlock,
                    // A declaration's text is a variable's name, not prose.
                    v1: {
                        id: "v1",
                        kind: "declaration",
                        parentId: null,
                        childrenIds: [],
                        payload: { scope: "scene", name: "colour", valueType: "number", storageKey: "v1" },
                    } as StoryBlock,
                },
            },
        },
    } as unknown as StoryDocument;
}

const needles = variantNeedles(normalizeDictionaryEntries([
    { term: "color", variants: ["colour"] },
    { term: "神楽坂", reading: "かぐらざか" },
]));

describe("reading a story against the dictionary", () => {
    it("finds every variant, with where it is and what the row says", () => {
        const findings = findInStoryDocument(storyDoc(), needles);

        expect(findings.map(finding => `${finding.target.blockId}:${finding.written}`))
            .toEqual(["b1:colour", "b2:Colour", "b2:colour"]);
        expect(findings[0]).toMatchObject({
            term: "color",
            written: "colour",
            replacement: "color",
            preview: "The colour of the sky.",
            target: {
                kind: "storyBlock",
                storyId: "story-1",
                sceneId: "scene-1",
                blockId: "b1",
                storyName: "Main Story",
                sceneName: "Opening",
            },
        });
        // The capitalisation is carried over, so replacing at the start of a sentence keeps it.
        expect(findings[1]).toMatchObject({ written: "Colour", replacement: "Color" });
    });

    it("says nothing about a row that writes the term the project's way", () => {
        const findings = findInStoryDocument(storyDoc(), needles);
        expect(findings.some(finding => finding.target.blockId === "b3")).toBe(false);
    });

    it("does not read a declaration row, whose text is a variable's name", () => {
        // Offering to "correct" it would rename the variable, which is not what the author asked.
        const findings = findInStoryDocument(storyDoc(), needles);
        expect(findings.some(finding => finding.target.blockId === "v1")).toBe(false);
    });

    it("leaves the readings out: a project-wide list of them is a list of the script", () => {
        const document = storyDoc();
        document.scenes["scene-1"].blocks.b1 = dialogue("b1", "神楽坂に着いた。");

        // The dictionary holds a reading for 神楽坂 and the row carries no ruby, so the open row
        // would offer one here. The project pass says nothing at all about that row.
        const findings = findInStoryDocument(document, needles);
        expect(findings.some(finding => finding.target.blockId === "b1")).toBe(false);
        expect(findings.every(finding => finding.term === "color")).toBe(true);
    });

    it("finds nothing when the dictionary has no variants to look for", () => {
        const bare = variantNeedles(normalizeDictionaryEntries([{ term: "color" }]));
        expect(bare).toEqual([]);
        expect(findInStoryDocument(storyDoc(), bare)).toEqual([]);
    });

    it("groups by term, in the order they were found", () => {
        const grouped = findingsByTerm(findInStoryDocument(storyDoc(), needles));
        expect([...grouped.keys()]).toEqual(["color"]);
        expect(grouped.get("color")).toHaveLength(3);
    });
});
