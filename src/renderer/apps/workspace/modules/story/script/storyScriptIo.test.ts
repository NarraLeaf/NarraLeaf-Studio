import { describe, expect, it } from "vitest";
import type { StoryScene } from "@shared/types/story";
import type { StoryScriptScenePlan } from "@/lib/story/script/storyScriptTypes";
import { applyStoryScriptScenes, storyScriptUndoCoverage } from "./storyScriptIo";

/**
 * The two decisions the import flow makes *after* the plan exists, extracted from the hook because
 * both of them were wrong in a way no type could catch: one claimed a whole import was unundoable
 * when a single scene was, and the other assumed a batch either fully lands or fully does not.
 */

function scenePlan(sceneId: string): StoryScriptScenePlan {
  const scene: StoryScene = {
    id: sceneId,
    name: sceneId,
    runtimeName: sceneId,
    rootBlockIds: [],
    blocks: {}
  };
  return {
    sceneId,
    sceneName: sceneId,
    scene,
    stats: { unchanged: 0, edited: 0, added: 0, removed: 0, cloned: 0, moved: 0 },
    stale: false,
    missing: false,
    diagnostics: []
  };
}

const SCENES = [scenePlan("a"), scenePlan("b"), scenePlan("c")];

describe("story script apply", () => {
  it("stops at the first scene that refuses, and says which ones were written", () => {
    const written: string[] = [];
    const result = applyStoryScriptScenes(SCENES, (scene) => {
      if (scene.sceneId === "b") {
        // What `replaceScene` does when the scene was deleted while the dialog was open.
        throw new Error("Scene not found: b");
      }
      written.push(scene.sceneId);
    });

    expect(written).toEqual(["a"]);
    expect(result.applied.map((scene) => scene.sceneId)).toEqual(["a"]);
    expect(result.failed?.scene.sceneId).toBe("b");
    expect(String((result.failed?.error as Error).message)).toContain("Scene not found");
  });

  it("reports every scene as applied when nothing refuses", () => {
    const result = applyStoryScriptScenes(SCENES, () => {});

    expect(result.applied).toHaveLength(3);
    expect(result.failed).toBeUndefined();
  });
});

describe("story script undo coverage", () => {
  it("is partial when only some of the scenes have an editor that can undo them", () => {
    expect(storyScriptUndoCoverage(SCENES, (sceneId) => sceneId === "a")).toEqual({
      coverage: "partial",
      unundoable: 2
    });
    expect(storyScriptUndoCoverage(SCENES, (sceneId) => sceneId !== "a")).toEqual({
      coverage: "partial",
      unundoable: 1
    });
  });

  it("is all or none only when it really is", () => {
    expect(storyScriptUndoCoverage(SCENES, () => true)).toEqual({ coverage: "all", unundoable: 0 });
    expect(storyScriptUndoCoverage(SCENES, () => false)).toEqual({
      coverage: "none",
      unundoable: 3
    });
    // Nothing to write is nothing to warn about.
    expect(storyScriptUndoCoverage([], () => false)).toEqual({ coverage: "all", unundoable: 0 });
  });
});
