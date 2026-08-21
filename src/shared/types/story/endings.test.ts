import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene } from "./document";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "./document";
import { duplicateStoryEndingNames, findStoryEnding, listSceneEndings, listStoryEndings } from "./endings";

/**
 * The one endings scan. Everything that lists, records or targets an ending reads it, so the rules
 * that make "the ending is the row" true are pinned here rather than left implicit in a consumer.
 */

function scene(id: string, name: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: blocks.filter(block => !block.parentId).map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function ending(id: string, name: string, extra: Partial<StoryBlock> = {}): StoryBlock {
    return {
        id,
        kind: "control",
        parentId: null,
        childrenIds: [],
        payload: { control: "ending", name },
        ...extra,
    } as StoryBlock;
}

function document(scenes: StoryScene[]): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "c1", name: "Chapter", sceneIds: scenes.map(entry => entry.id) }],
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
    };
}

describe("listSceneEndings", () => {
    it("reads endings in document order, with the name trimmed", () => {
        const found = listSceneEndings(scene("s1", "Prologue", [ending("a", "  True End "), ending("b", "Bad End")]));
        expect(found.map(entry => [entry.endingId, entry.name])).toEqual([["a", "True End"], ["b", "Bad End"]]);
    });

    it("keeps an unnamed ending, because the row is the ending and the name is only display text", () => {
        // The command refuses to commit a bare `/ending`, but an imported document may still carry
        // one - and dropping it would take an ending a player can reach out of every list.
        expect(listSceneEndings(scene("s1", "S", [ending("a", "   ")]))).toHaveLength(1);
    });

    it("reaches an ending nested inside a container", () => {
        const menu: StoryBlock = {
            id: "menu", kind: "control", parentId: null, childrenIds: ["deep"], payload: { control: "sequence" },
        } as StoryBlock;
        const deep = ending("deep", "Inside", { parentId: "menu" });
        expect(listSceneEndings(scene("s1", "S", [menu, deep])).map(entry => entry.endingId)).toEqual(["deep"]);
    });

    it("drops a disabled ending, and every ending under a disabled ancestor", () => {
        // Disabling takes the row out of the build, so the ending is not one a player can reach and
        // not one a gallery could ever unlock.
        const off = ending("off", "Gone", { disabled: true });
        const container: StoryBlock = {
            id: "grp", kind: "control", parentId: null, childrenIds: ["under"], payload: { control: "sequence" }, disabled: true,
        } as StoryBlock;
        const under = ending("under", "AlsoGone", { parentId: "grp" });
        expect(listSceneEndings(scene("s1", "S", [off, container, under]))).toEqual([]);
    });

    it("carries the page the row names, and omits it when the row names none", () => {
        const withPage = ending("a", "Credits", { payload: { control: "ending", name: "Credits", page: { kind: "surface", surfaceId: "surface-1" } } } as Partial<StoryBlock>);
        const found = listSceneEndings(scene("s1", "S", [withPage, ending("b", "Plain")]));
        expect(found[0].page).toEqual({ kind: "surface", surfaceId: "surface-1" });
        expect(found[1].page).toBeUndefined();
    });
});

describe("listStoryEndings", () => {
    it("walks every scene in document order and names the scene each ending sits in", () => {
        const doc = document([
            scene("s1", "Prologue", [ending("a", "Early Out")]),
            scene("s2", "Rooftop", [ending("b", "True End")]),
        ]);
        expect(listStoryEndings(doc)).toEqual([
            { endingId: "a", name: "Early Out", sceneId: "s1", sceneName: "Prologue" },
            { endingId: "b", name: "True End", sceneId: "s2", sceneName: "Rooftop" },
        ]);
    });

    it("answers an empty list for a document with no ending row", () => {
        expect(listStoryEndings(document([scene("s1", "S", [])]))).toEqual([]);
    });

    it("finds one ending by id, and answers null for an id no row carries", () => {
        const doc = document([scene("s1", "S", [ending("a", "True End")])]);
        expect(findStoryEnding(doc, "a")?.name).toBe("True End");
        expect(findStoryEnding(doc, "nope")).toBeNull();
        expect(findStoryEnding(doc, "")).toBeNull();
    });
});

describe("duplicateStoryEndingNames", () => {
    it("reports the LATER row, since the first is the one that keeps the name", () => {
        const doc = document([
            scene("s1", "A", [ending("a", "Bad End"), ending("b", "Bad End")]),
            scene("s2", "B", [ending("c", "Bad End"), ending("d", "True End")]),
        ]);
        expect(duplicateStoryEndingNames(doc).map(entry => entry.endingId)).toEqual(["b", "c"]);
    });

    it("says nothing about unnamed endings, which share no name with anything", () => {
        expect(duplicateStoryEndingNames(document([scene("s1", "A", [ending("a", ""), ending("b", "")])]))).toEqual([]);
    });
});
