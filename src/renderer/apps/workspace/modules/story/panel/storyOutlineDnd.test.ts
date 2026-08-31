import { describe, expect, it } from "vitest";
import type { StoryDocument, StoryScene } from "@shared/types/story";
import {
    isOutlineDropAllowed,
    outlineEdgeFromPointer,
    resolveChapterDrop,
    resolveSceneDrop,
} from "./storyOutlineDnd";

function scene(id: string): StoryScene {
    return { id, name: id, runtimeName: id, blocks: {}, rootBlockIds: [] } as unknown as StoryScene;
}

/** Two chapters: `c1` holds s1..s3, `c2` holds s4, `c3` is empty. */
function document(): StoryDocument {
    return {
        schemaVersion: 12,
        id: "story-1",
        name: "Story",
        chapters: [
            { id: "c1", name: "One", sceneIds: ["s1", "s2", "s3"] },
            { id: "c2", name: "Two", sceneIds: ["s4"] },
            { id: "c3", name: "Three", sceneIds: [] },
        ],
        scenes: {
            s1: scene("s1"),
            s2: scene("s2"),
            s3: scene("s3"),
            s4: scene("s4"),
        },
    } as unknown as StoryDocument;
}

describe("outlineEdgeFromPointer", () => {
    it("splits a row at its midpoint", () => {
        expect(outlineEdgeFromPointer(104, { top: 100, height: 20 })).toBe("before");
        expect(outlineEdgeFromPointer(116, { top: 100, height: 20 })).toBe("after");
    });
});

describe("resolveSceneDrop", () => {
    it("moves a scene up inside its own chapter", () => {
        expect(resolveSceneDrop(document(), "s3", { kind: "scene", sceneId: "s1", edge: "before" }))
            .toEqual({ chapterId: "c1", beforeSceneId: "s1" });
    });

    it("reads the anchor off the chapter with the dragged scene already taken out", () => {
        // Dropping s1 after s2 must land it between s2 and s3. Read off the list as drawn, `after
        // s2` would be index 2 - which is where s3 is only while s1 is still in front of it.
        expect(resolveSceneDrop(document(), "s1", { kind: "scene", sceneId: "s2", edge: "after" }))
            .toEqual({ chapterId: "c1", beforeSceneId: "s3" });
    });

    it("appends when the drop is past the last scene of a chapter", () => {
        expect(resolveSceneDrop(document(), "s1", { kind: "scene", sceneId: "s3", edge: "after" }))
            .toEqual({ chapterId: "c1", beforeSceneId: null });
    });

    it("files a scene into another chapter at the anchor", () => {
        expect(resolveSceneDrop(document(), "s1", { kind: "scene", sceneId: "s4", edge: "before" }))
            .toEqual({ chapterId: "c2", beforeSceneId: "s4" });
    });

    it("puts a scene dropped on a chapter header first in that chapter", () => {
        expect(resolveSceneDrop(document(), "s1", { kind: "chapter", chapterId: "c2", edge: "after" }))
            .toEqual({ chapterId: "c2", beforeSceneId: "s4" });
    });

    it("takes an empty chapter", () => {
        expect(resolveSceneDrop(document(), "s1", { kind: "chapter", chapterId: "c3", edge: "before" }))
            .toEqual({ chapterId: "c3", beforeSceneId: null });
    });

    it("refuses the positions the scene is already in", () => {
        const doc = document();
        // On its own row.
        expect(resolveSceneDrop(doc, "s2", { kind: "scene", sceneId: "s2", edge: "before" })).toBeNull();
        // The gap above it, which is the gap it came out of.
        expect(resolveSceneDrop(doc, "s2", { kind: "scene", sceneId: "s1", edge: "after" })).toBeNull();
        // And the gap below it.
        expect(resolveSceneDrop(doc, "s2", { kind: "scene", sceneId: "s3", edge: "before" })).toBeNull();
        // The header of the chapter it already leads.
        expect(resolveSceneDrop(doc, "s1", { kind: "chapter", chapterId: "c1", edge: "before" })).toBeNull();
    });

    it("refuses a scene the document does not have", () => {
        expect(resolveSceneDrop(document(), "nope", { kind: "chapter", chapterId: "c2", edge: "before" })).toBeNull();
    });
});

describe("resolveChapterDrop", () => {
    it("moves a chapter above another", () => {
        expect(resolveChapterDrop(document(), "c3", { kind: "chapter", chapterId: "c1", edge: "before" }))
            .toEqual({ beforeChapterId: "c1" });
    });

    it("appends when the drop is past the last chapter", () => {
        expect(resolveChapterDrop(document(), "c1", { kind: "chapter", chapterId: "c3", edge: "after" }))
            .toEqual({ beforeChapterId: null });
    });

    it("reads the anchor off the list with the dragged chapter taken out", () => {
        expect(resolveChapterDrop(document(), "c1", { kind: "chapter", chapterId: "c2", edge: "after" }))
            .toEqual({ beforeChapterId: "c3" });
    });

    it("refuses its own row, the gaps either side of it, and every scene row", () => {
        const doc = document();
        expect(resolveChapterDrop(doc, "c2", { kind: "chapter", chapterId: "c2", edge: "before" })).toBeNull();
        expect(resolveChapterDrop(doc, "c2", { kind: "chapter", chapterId: "c1", edge: "after" })).toBeNull();
        expect(resolveChapterDrop(doc, "c2", { kind: "chapter", chapterId: "c3", edge: "before" })).toBeNull();
        expect(resolveChapterDrop(doc, "c2", { kind: "scene", sceneId: "s1", edge: "before" })).toBeNull();
    });
});

describe("isOutlineDropAllowed", () => {
    it("lights a row only where the drop it would perform changes something", () => {
        const doc = document();
        expect(isOutlineDropAllowed(doc, { kind: "scene", sceneId: "s1" }, { kind: "scene", sceneId: "s4", edge: "before" })).toBe(true);
        expect(isOutlineDropAllowed(doc, { kind: "scene", sceneId: "s1" }, { kind: "scene", sceneId: "s2", edge: "before" })).toBe(false);
        expect(isOutlineDropAllowed(doc, { kind: "chapter", chapterId: "c1" }, { kind: "chapter", chapterId: "c2", edge: "after" })).toBe(true);
        expect(isOutlineDropAllowed(doc, { kind: "chapter", chapterId: "c1" }, { kind: "scene", sceneId: "s4", edge: "after" })).toBe(false);
    });
});
