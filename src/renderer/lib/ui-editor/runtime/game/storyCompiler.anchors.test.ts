import { describe, expect, it } from "vitest";
import { compileStudioStoryToNlr } from "./storyCompiler";
import type { StoryDocument } from "@shared/types/story";

/**
 * A save anchors on action ids, so what an edit does to those ids is what an edit does to every save
 * a player already has. Writing a new line used to renumber every action after it, which meant a
 * one-word fix in chapter one broke every save past that point.
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

function document(): StoryDocument {
    return {
        schemaVersion: 16,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "One",
                runtimeName: "one",
                rootBlockIds: ["a1", "a2"],
                blocks: { a1: narration("a1", "first"), a2: narration("a2", "second") },
            },
            "scene-b": {
                id: "scene-b",
                name: "Two",
                runtimeName: "two",
                rootBlockIds: ["b1", "b2"],
                blocks: { b1: narration("b1", "third"), b2: narration("b2", "fourth") },
            },
        },
    } as unknown as StoryDocument;
}

async function anchorsOf(doc: StoryDocument): Promise<string[]> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    return compiled.actionIdBindings.map(binding => binding.staticId);
}

describe("action anchors", () => {
    it("keeps every existing anchor when a line is inserted ahead of them", async () => {
        const before = await anchorsOf(document());

        const edited = document();
        edited.scenes["scene-a"].blocks.a0 = narration("a0", "a line added later") as never;
        edited.scenes["scene-a"].rootBlockIds.unshift("a0");
        const after = new Set(await anchorsOf(edited));

        expect(before.length).toBeGreaterThan(0);
        expect(before.filter(anchor => !after.has(anchor))).toEqual([]);
    });

    it("keeps every anchor outside the edited row when a line is deleted", async () => {
        const before = await anchorsOf(document());
        const beforeOwnedByA1 = before.filter(anchor => anchor.includes(":a1:"));
        expect(beforeOwnedByA1.length).toBeGreaterThan(0);

        const edited = document();
        delete edited.scenes["scene-a"].blocks.a1;
        edited.scenes["scene-a"].rootBlockIds = ["a2"];
        const after = new Set(await anchorsOf(edited));

        const lost = before.filter(anchor => !after.has(anchor));
        expect(lost).toEqual(beforeOwnedByA1);
    });

    it("gives two rows different anchors", async () => {
        const anchors = await anchorsOf(document());
        expect(new Set(anchors).size).toBe(anchors.length);
    });

    it("rewriting a line's prose does not move its anchor", async () => {
        const before = await anchorsOf(document());
        const edited = document();
        edited.scenes["scene-a"].blocks.a1 = narration("a1", "first, rewritten entirely") as never;
        expect(await anchorsOf(edited)).toEqual(before);
    });
});
