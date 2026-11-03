import { describe, expect, it } from "vitest";
import type { StoryScene } from "@shared/types/story";
import type { StoryScriptScenePlan } from "@/lib/story/script/storyScriptTypes";
import { applyStoryScriptScenes } from "./storyScriptIo";

function scenePlan(sceneId: string): StoryScriptScenePlan {
    const scene: StoryScene = { id: sceneId, name: sceneId, runtimeName: sceneId, rootBlockIds: [], blocks: {} };
    return {
        sceneId,
        sceneName: sceneId,
        scene,
        stats: { unchanged: 0, edited: 0, added: 0, removed: 0, cloned: 0, moved: 0 },
        stale: false,
        missing: false,
        diagnostics: [],
    };
}

const SCENES = [scenePlan("a"), scenePlan("b"), scenePlan("c")];

describe("story script apply", () => {
    it("stops at the first scene that refuses, and says which ones were written", () => {
        const written: string[] = [];
        const result = applyStoryScriptScenes(SCENES, scene => {
            if (scene.sceneId === "b") {
                // What `replaceScene` does when the scene was deleted while the dialog was open.
                throw new Error("Scene not found: b");
            }
            written.push(scene.sceneId);
        });

        expect(written).toEqual(["a"]);
        expect(result.applied.map(scene => scene.sceneId)).toEqual(["a"]);
        expect(result.failed?.scene.sceneId).toBe("b");
        expect(String((result.failed?.error as Error).message)).toContain("Scene not found");
    });

    it("reports every scene as applied when nothing refuses", () => {
        const result = applyStoryScriptScenes(SCENES, () => {});

        expect(result.applied).toHaveLength(3);
        expect(result.failed).toBeUndefined();
    });
});
