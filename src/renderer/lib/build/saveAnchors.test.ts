import { describe, expect, it } from "vitest";
import { collectSaveAnchors, diffSaveAnchors, type SaveAnchorSet } from "./saveAnchors";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { StoryDocument } from "@shared/types/story";

/**
 * What a patch does to existing saves, reported as the two things it can be.
 *
 * The distinction is the whole point: one kind of loss stops a save opening and says so, the other
 * is applied silently to nothing. A test that only counted losses would pass while the report told
 * an author the wrong story about which of those they were about to ship.
 */

function narration(id: string, text: string) {
    return {
        kind: "nodeAction",
        id,
        parentId: null,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `${id}-text`, role: "narration", value: text } },
    };
}

function scene(id: string, name: string, blockIds: string[]) {
    return {
        id,
        name,
        runtimeName: name.toLowerCase(),
        rootBlockIds: [...blockIds],
        blocks: Object.fromEntries(blockIds.map(blockId => [blockId, narration(blockId, blockId)])),
    };
}

function packOf(document: StoryDocument): GameRuntimePackV1 {
    return {
        bundle: {
            storyLibrary: {
                documents: { [document.id]: document },
                index: { stories: [{ id: document.id, name: "Chapter One" }] },
            },
            ui: {},
        },
    } as unknown as GameRuntimePackV1;
}

function document(): StoryDocument {
    return {
        schemaVersion: 16,
        id: "story-1",
        name: "Chapter One",
        entrySceneId: "scene-a",
        scenes: {
            "scene-a": scene("scene-a", "Classroom", ["a1", "a2", "a3"]),
            "scene-b": scene("scene-b", "Rooftop", ["b1", "b2"]),
        },
    } as unknown as StoryDocument;
}

const anchorsOf = (doc: StoryDocument): Promise<SaveAnchorSet> => collectSaveAnchors(packOf(doc));

describe("save anchors", () => {
    it("collects both kinds and names the scene each belongs to", async () => {
        const set = await anchorsOf(document());

        expect(set.actions.length).toBeGreaterThan(0);
        expect(set.elements.length).toBeGreaterThan(0);
        expect(set.storyErrors).toEqual([]);
        expect(set.sceneNames["scene-a"]).toBe("Chapter One / Classroom");
        // The two shapes a save can hold, and they must not be mixed into one list.
        expect(set.actions.every(anchor => anchor.startsWith("studio:"))).toBe(true);
        expect(set.elements.every(anchor => anchor.startsWith("nl:"))).toBe(true);
    });

    it("reports nothing when the story did not change", async () => {
        const diff = diffSaveAnchors(await anchorsOf(document()), await anchorsOf(document()));

        expect(diff.refusesToLoad).toEqual([]);
        expect(diff.loadsWithHazard).toEqual([]);
        expect(diff.incomplete).toBe(false);
    });

    it("reports nothing when a line is added, which is what a patch is for", async () => {
        const before = await anchorsOf(document());
        const edited = document();
        edited.scenes["scene-a"].rootBlockIds.push("a4");
        (edited.scenes["scene-a"].blocks as Record<string, unknown>).a4 = narration("a4", "a new line");

        const diff = diffSaveAnchors(before, await anchorsOf(edited));

        expect(diff.refusesToLoad).toEqual([]);
        expect(diff.loadsWithHazard).toEqual([]);
    });

    it("a deleted line is the kind that refuses the load, and only that kind", async () => {
        const before = await anchorsOf(document());
        const edited = document();
        edited.scenes["scene-a"].rootBlockIds = ["a1", "a3"];
        delete (edited.scenes["scene-a"].blocks as Record<string, unknown>).a2;

        const diff = diffSaveAnchors(before, await anchorsOf(edited));

        expect(diff.refusesToLoad.length).toBeGreaterThan(0);
        expect(diff.refusesToLoad.every(loss => loss.where === "Chapter One / Classroom")).toBe(true);
        // The scene is still there, so nothing a save held state for went missing.
        expect(diff.loadsWithHazard).toEqual([]);
    });

    it("a deleted scene loses both kinds, and says where", async () => {
        const before = await anchorsOf(document());
        const edited = document();
        delete (edited.scenes as Record<string, unknown>)["scene-b"];

        const diff = diffSaveAnchors(before, await anchorsOf(edited));

        expect(diff.refusesToLoad.length).toBeGreaterThan(0);
        expect(diff.loadsWithHazard.length).toBeGreaterThan(0);
        for (const loss of [...diff.refusesToLoad, ...diff.loadsWithHazard]) {
            expect(loss.where).toBe("Chapter One / Rooftop");
        }
    });

    it("says so when a story could not be read, rather than reporting a clean comparison", async () => {
        // Straight against the diff, not through a contrived document: what matters is that a
        // partial read is never reported as a clean one, and which malformed input happens to make
        // this compiler throw is not the contract.
        const before = await anchorsOf(document());
        const unreadable: SaveAnchorSet = {
            actions: before.actions,
            elements: before.elements,
            sceneNames: before.sceneNames,
            storyErrors: [{ story: "Chapter Two", message: "could not be compiled" }],
        };

        const diff = diffSaveAnchors(before, unreadable);
        expect(diff.refusesToLoad).toEqual([]);
        expect(diff.loadsWithHazard).toEqual([]);
        expect(diff.incomplete).toBe(true);
    });
});
