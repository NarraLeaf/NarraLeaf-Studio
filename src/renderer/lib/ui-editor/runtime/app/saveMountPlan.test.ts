import { describe, expect, it } from "vitest";
import { STORY_DOCUMENT_SCHEMA_VERSION, type StoryBlock, type StoryDocument, type StoryScene } from "@shared/types/story";
import { planSaveMount } from "./saveMountPlan";

/**
 * A three-scene story in a line - corridor, club room, last light - plus a scene nothing jumps to,
 * which only a blueprint could enter. The shape of the shipped skeleton, where these defects were
 * found.
 */
function jump(id: string, targetSceneId: string): StoryBlock {
    return { id, kind: "jump", parentId: null, childrenIds: [], payload: { targetSceneId } } as StoryBlock;
}

function line(id: string): StoryBlock {
    return { id, kind: "nodeAction", parentId: null, childrenIds: [], payload: { action: "narration" } } as unknown as StoryBlock;
}

function scene(id: string, blocks: StoryBlock[]): StoryScene {
    return {
        id,
        name: id,
        runtimeName: id,
        rootBlockIds: blocks.map(entry => entry.id),
        blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
    };
}

const story: StoryDocument = {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    id: "story-1",
    name: "Story",
    chapters: [],
    scenes: {
        corridor: scene("corridor", [line("c1"), jump("c2", "club")]),
        club: scene("club", [line("r1"), jump("r2", "light")]),
        light: scene("light", [line("l1")]),
        epilogue: scene("epilogue", [line("e1")]),
    },
} as StoryDocument;

describe("planSaveMount", () => {
    it("mounts the story again for a save written anywhere, when the session was started at a row", () => {
        // A save in the club room, written after the corridor: it carries both scenes. A row launch
        // enters through a scene of its own, which has neither.
        expect(planSaveMount({
            document: story,
            mounted: { sceneId: "club", startBlockId: "r1" },
            preferredEntrySceneId: "corridor",
            saveSceneId: "club",
            sceneIds: ["corridor", "club"],
        })).toEqual({ kind: "remount", entrySceneId: "corridor" });
    });

    it("keeps a session that reaches every scene the save names", () => {
        expect(planSaveMount({
            document: story,
            mounted: { sceneId: "corridor" },
            preferredEntrySceneId: "corridor",
            saveSceneId: "light",
            sceneIds: ["corridor", "club", "light"],
        })).toEqual({ kind: "same" });
    });

    it("mounts the story again when the session was started at a scene after the one the save needs", () => {
        expect(planSaveMount({
            document: story,
            mounted: { sceneId: "light" },
            preferredEntrySceneId: "corridor",
            saveSceneId: "club",
            sceneIds: ["corridor", "club"],
        })).toEqual({ kind: "remount", entrySceneId: "corridor" });
    });

    it("falls back to the save's own scene when the usual entry does not reach it", () => {
        expect(planSaveMount({
            document: story,
            mounted: { sceneId: "light", startBlockId: "l1" },
            preferredEntrySceneId: "corridor",
            saveSceneId: "epilogue",
            sceneIds: ["epilogue"],
        })).toEqual({ kind: "remount", entrySceneId: "epilogue" });
    });

    it("leaves a plain session alone when no entry reaches everything, so the load says what is missing", () => {
        // A save naming two scenes no single entry reaches. A row launch still gets a plain mount
        // at the save's scene; a plain session would only be swapped for another that fails too.
        const input = {
            document: story,
            preferredEntrySceneId: "corridor",
            saveSceneId: "epilogue",
            sceneIds: ["epilogue", "club"],
        };
        expect(planSaveMount({ ...input, mounted: { sceneId: "corridor" } })).toEqual({ kind: "same" });
        expect(planSaveMount({ ...input, mounted: { sceneId: "corridor", startBlockId: "c1" } }))
            .toEqual({ kind: "remount", entrySceneId: "epilogue" });
    });

    it("ignores scenes the document does not have", () => {
        expect(planSaveMount({
            document: story,
            mounted: { sceneId: "corridor" },
            preferredEntrySceneId: "corridor",
            saveSceneId: "club",
            sceneIds: ["club", "a-scene-of-another-story"],
        })).toEqual({ kind: "same" });
    });
});
