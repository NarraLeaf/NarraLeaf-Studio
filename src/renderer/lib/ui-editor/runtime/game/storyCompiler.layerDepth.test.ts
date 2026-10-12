import { describe, expect, it } from "vitest";
import type { Layer, Scene } from "narraleaf-react";
import { compileStudioStoryToNlr } from "./storyCompiler";
import type { StoryDocument } from "@shared/types/story";

function row(id: string, payload: Record<string, unknown>, kind = "action") {
    return { kind, id, parentId: null, childrenIds: [], payload };
}

function document(): StoryDocument {
    const blocks = {
        bg: row("bg", { action: "layer", operation: "setDepth", objectName: "", target: { kind: "default", layer: "background" }, depth: "farthest" }),
        hills: row("hills", { action: "layer", operation: "create", objectName: "hills", zIndex: -1, depth: "far" }),
        fog: row("fog", { action: "layer", operation: "create", objectName: "fog", zIndex: 2 }),
        line: row("line", { action: "narration", text: { textId: "line-text", role: "narration", value: "Here." } }, "nodeAction"),
    };
    return {
        schemaVersion: 29,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": { id: "scene-a", name: "One", runtimeName: "one", rootBlockIds: Object.keys(blocks), blocks },
        },
    } as unknown as StoryDocument;
}

async function entryScene(doc: StoryDocument): Promise<Scene> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    return (compiled.story as unknown as { entryScene: Scene }).entryScene;
}

const parallaxOf = (layer: Layer): number => (layer as unknown as { getParallax(): number }).getParallax();

function layerNamed(scene: Scene, name: string): Layer {
    const layers = (scene as unknown as { config: { layers: Layer[] } }).config.layers;
    const layer = layers.find(l => (l as unknown as { config: { name: string } }).config.name === name);
    if (!layer) {
        throw new Error(`no layer ${name}`);
    }
    return layer;
}

describe("layer depth", () => {
    it("builds each layer at the distance its row names, and the scene's background layer at its row's", async () => {
        const scene = await entryScene(document());
        expect(parallaxOf(layerNamed(scene, "hills"))).toBe(0.3);
        expect(parallaxOf(layerNamed(scene, "fog"))).toBe(1);
        expect(parallaxOf(scene.backgroundLayer)).toBe(0);
    });

    it("follows a depth edited in place on the same scene, as the editor's preview recompiles it", async () => {
        // The story service edits a scene object in place, so a compile that remembered the depths
        // it read the first time would keep showing them after the author changed one.
        const doc = document();
        await entryScene(doc);
        const blocks = doc.scenes["scene-a"].blocks as unknown as Record<string, { payload: Record<string, unknown> }>;
        blocks.fog.payload.depth = "near";
        blocks.bg.payload.depth = "mid";
        const scene = await entryScene(doc);
        expect(parallaxOf(layerNamed(scene, "fog"))).toBe(1.4);
        expect(parallaxOf(scene.backgroundLayer)).toBe(0.6);
    });
});
