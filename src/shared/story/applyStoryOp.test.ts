import { describe, expect, it } from "vitest";
import type { LiveStoryOp } from "@shared/live/ops";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { applyStoryOpToDocument, storyOpSceneReach } from "./applyStoryOp";
import { createEmptyStoryDocument } from "./storyModel";

const NOW = "2026-11-14T00:00:00.000Z";
const LATER = "2026-11-14T01:00:00.000Z";
const STORY_ID = "00000000-0000-4000-8000-000000000001";

function freshDocument(): { document: StoryDocument; chapterId: string; sceneId: string } {
    let next = 100;
    const document = createEmptyStoryDocument({
        id: STORY_ID,
        name: "Story",
        now: NOW,
        generateId: () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`,
    });
    return { document, chapterId: document.chapters[0].id, sceneId: document.chapters[0].sceneIds[0] };
}

function narration(id: string, value: string): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `t-${id}`, role: "narration", value } },
    };
}

function apply(document: StoryDocument, op: LiveStoryOp) {
    return applyStoryOpToDocument(document, op, { now: LATER });
}

describe("applyStoryOpToDocument", () => {
    it("inserts, updates, moves, disables and deletes rows", () => {
        const { document, sceneId } = freshDocument();
        apply(document, { op: "insert-block", sceneId, block: narration("a", "one"), target: { parentId: null } });
        apply(document, { op: "insert-block", sceneId, block: narration("b", "two"), target: { parentId: null } });
        expect(document.scenes[sceneId].rootBlockIds).toEqual(["a", "b"]);

        apply(document, { op: "move-block", sceneId, blockId: "b", target: { parentId: null, beforeBlockId: "a" } });
        expect(document.scenes[sceneId].rootBlockIds).toEqual(["b", "a"]);

        apply(document, { op: "update-block", sceneId, blockId: "a", payload: narration("a", "uno").payload });
        expect(document.scenes[sceneId].blocks.a.payload).toEqual(narration("a", "uno").payload);

        apply(document, { op: "set-block-disabled", sceneId, blockId: "a", disabled: true });
        expect(document.scenes[sceneId].blocks.a.disabled).toBe(true);
        apply(document, { op: "set-block-disabled", sceneId, blockId: "a", disabled: false });
        expect("disabled" in document.scenes[sceneId].blocks.a).toBe(false);

        apply(document, { op: "delete-blocks", sceneId, blockIds: ["a", "b"] });
        expect(document.scenes[sceneId].rootBlockIds).toEqual([]);
    });

    it("refuses a row operation on a scene that is not there by throwing", () => {
        const { document } = freshDocument();
        expect(() => apply(document, { op: "delete-block", sceneId: "missing", blockId: "a" })).toThrow(/Scene not found/);
    });

    it("answers unchanged for a structural operation that names nothing", () => {
        const { document } = freshDocument();
        const before = structuredClone(document);
        expect(apply(document, { op: "rename-chapter", chapterId: "missing", name: "X" }).changed).toBe(false);
        expect(apply(document, { op: "delete-scene", sceneId: "missing" }).changed).toBe(false);
        expect(document).toEqual(before);
    });

    it("pins a scene's runtime name before renaming it", () => {
        const { document, sceneId } = freshDocument();
        document.scenes[sceneId].runtimeName = "";
        apply(document, { op: "rename-scene", sceneId, name: "Renamed" });
        expect(document.scenes[sceneId].name).toBe("Renamed");
        expect(document.scenes[sceneId].runtimeName).not.toBe("");
        expect(document.scenes[sceneId].meta?.updatedAt).toBe(LATER);
    });

    it("creates, moves and deletes scenes, keeping the entry pointer on a scene that exists", () => {
        const { document, chapterId, sceneId } = freshDocument();
        const second = { ...structuredClone(document.scenes[sceneId]), id: "s2", name: "Two", runtimeName: "two" };
        apply(document, { op: "create-scene", scene: second, chapterId, beforeSceneId: sceneId });
        expect(document.chapters[0].sceneIds).toEqual(["s2", sceneId]);

        apply(document, { op: "move-scene", sceneId: "s2", chapterId, beforeSceneId: null });
        expect(document.chapters[0].sceneIds).toEqual([sceneId, "s2"]);

        apply(document, { op: "delete-scene", sceneId });
        expect(document.scenes[sceneId]).toBeUndefined();
        expect(document.entrySceneId).toBe("s2");
    });

    it("deletes a chapter with its scenes and keeps unnamed chapters when reordering", () => {
        const { document, chapterId } = freshDocument();
        const other = { id: "c2", name: "Two", sceneIds: [], meta: { createdAt: NOW, updatedAt: NOW } };
        apply(document, { op: "create-chapter", chapter: other, beforeChapterId: chapterId });
        expect(document.chapters.map(c => c.id)).toEqual(["c2", chapterId]);

        apply(document, { op: "reorder-chapters", chapterIds: [chapterId] });
        expect(document.chapters.map(c => c.id)).toEqual([chapterId, "c2"]);

        apply(document, { op: "delete-chapter", chapterId });
        expect(document.chapters.map(c => c.id)).toEqual(["c2"]);
        expect(Object.keys(document.scenes)).toEqual([]);
        expect(document.entrySceneId).toBeUndefined();
    });

    it("produces the same document on two machines from the same operations", () => {
        const a = freshDocument();
        const b = freshDocument();
        const ops: LiveStoryOp[] = [
            { op: "insert-block", sceneId: a.sceneId, block: narration("x", "hello"), target: { parentId: null } },
            { op: "rename-story", name: "Renamed" },
            { op: "update-scene", sceneId: a.sceneId, fields: { name: "S", runtimeName: "s", description: "d" } },
        ];
        for (const op of ops) {
            apply(a.document, structuredClone(op));
            apply(b.document, structuredClone(op));
        }
        expect(a.document).toEqual(b.document);
        expect(a.document.name).toBe("Renamed");
    });

    it("names the scenes a row operation reaches, and nothing for a structural one", () => {
        expect(storyOpSceneReach({ op: "delete-block", sceneId: "s", blockId: "b" })).toEqual(["s"]);
        expect(storyOpSceneReach({ op: "delete-scene", sceneId: "s" })).toBeUndefined();
    });
});
