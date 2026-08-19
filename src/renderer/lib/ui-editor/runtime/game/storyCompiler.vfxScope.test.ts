import { describe, expect, it } from "vitest";
import { compileStudioStoryToNlr } from "./storyCompiler";
import type { StoryDocument } from "@shared/types/story";

/**
 * An ambience overlay outlives the scene that started it, so it has to be addressable from the
 * scenes that come after.
 *
 * The engine holds a `Vfx` on `GameState`, not on a scene: scene exit does not take it away and
 * only its own `hide` does. Compiling one overlay per scene therefore produced a stage nobody could
 * drive - rain started in the first scene kept falling, the second scene's `/hide rain` resolved no
 * handle and compiled to nothing, and a second `/vfx rain` built a whole second overlay on top of
 * the first. All three are the same mistake, which is why they are pinned together here.
 */

const CLIP = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIP = "33333333-3333-4333-8333-333333333333";

function vfxBlock(id: string, operation: string, objectName: string, assetId?: string) {
    return {
        kind: "action",
        id,
        parentId: null,
        childrenIds: [],
        payload: { action: "vfx", operation, objectName, ...(assetId ? { assetId } : {}) },
    };
}

function document(sceneBBlock: ReturnType<typeof vfxBlock>): StoryDocument {
    return {
        schemaVersion: 18,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": {
                id: "scene-a",
                name: "One",
                runtimeName: "one",
                rootBlockIds: ["a1"],
                blocks: { a1: vfxBlock("a1", "create", "rain", CLIP) },
            },
            "scene-b": {
                id: "scene-b",
                name: "Two",
                runtimeName: "two",
                rootBlockIds: ["b1"],
                blocks: { b1: sceneBBlock },
            },
        },
    } as unknown as StoryDocument;
}

async function compile(doc: StoryDocument) {
    return compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
}

describe("ambience overlays across scenes", () => {
    it("gives one name one overlay, however many scenes name it", async () => {
        const compiled = await compile(document(vfxBlock("b1", "hide", "rain")));

        const ids = compiled.elementIdBindings.filter(id => id.startsWith("nl:vfx:"));
        expect(ids).toEqual(["nl:vfx:rain"]);
    });

    it("resolves a hide in a later scene instead of compiling nothing", async () => {
        const compiled = await compile(document(vfxBlock("b1", "hide", "rain")));

        // The old failure spoke: it warned that the effect had no clip, because the second scene's
        // map was empty and a hide row carries no asset to build one from.
        expect(compiled.diagnostics.filter(entry => /Ambience effect/.test(entry.message))).toEqual([]);
    });

    it("keeps the id out of the scene it was created in", async () => {
        // A scene-qualified id would move the moment the author moved the create row, or reordered
        // the scenes, and a save that named the old one restores nothing.
        const compiled = await compile(document(vfxBlock("b1", "hide", "rain")));

        expect(compiled.elementIdBindings.some(id => /^nl:vfx:scene-/.test(id))).toBe(false);
    });

    it("reports a second row that names a different clip for the same overlay", async () => {
        const compiled = await compile(document(vfxBlock("b1", "create", "rain", OTHER_CLIP)));

        const reported = compiled.diagnostics.filter(entry => /different clip/.test(entry.message));
        expect(reported).toHaveLength(1);
        expect(reported[0].level).toBe("warning");
        expect(reported[0].blockId).toBe("b1");
        // Still one overlay: the row addresses what is already on stage rather than stacking.
        expect(compiled.elementIdBindings.filter(id => id.startsWith("nl:vfx:"))).toEqual(["nl:vfx:rain"]);
    });

    it("says nothing when the second row names the same clip", async () => {
        const compiled = await compile(document(vfxBlock("b1", "create", "rain", CLIP)));

        expect(compiled.diagnostics.filter(entry => /different clip/.test(entry.message))).toEqual([]);
    });
});
