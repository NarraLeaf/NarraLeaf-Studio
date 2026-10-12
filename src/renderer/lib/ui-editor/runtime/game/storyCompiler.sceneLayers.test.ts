import { describe, expect, it } from "vitest";
import type { Layer, Scene } from "narraleaf-react";
import { compileStudioStoryToNlr } from "./storyCompiler";
import type { StoryDocument, StorySceneLayer } from "@shared/types/story";

function row(id: string, payload: Record<string, unknown>, kind = "action") {
    return { kind, id, parentId: null, childrenIds: [], payload };
}

function document(layers: StorySceneLayer[]): StoryDocument {
    const blocks = {
        hillsPicture: row("hillsPicture", { action: "image", operation: "create", objectName: "ridge", assetId: "a", layer: { kind: "custom", sourceBlockId: "hills", name: "hills" } }),
        line: row("line", { action: "narration", text: { textId: "line-text", role: "narration", value: "Here." } }, "nodeAction"),
    };
    return {
        schemaVersion: 30,
        id: "story-1",
        name: "Story",
        scenes: {
            "scene-a": { id: "scene-a", name: "One", runtimeName: "one", rootBlockIds: Object.keys(blocks), blocks, layers },
        },
    } as unknown as StoryDocument;
}

const STACK: StorySceneLayer[] = [
    { kind: "custom", id: "fog", name: "fog", follow: 1.4 },
    { kind: "displayable" },
    { kind: "custom", id: "street", name: "street" },
    { kind: "custom", id: "hills", name: "hills", follow: 0.3 },
    { kind: "background", follow: 0 },
];

async function entryScene(doc: StoryDocument): Promise<Scene> {
    const compiled = await compileStudioStoryToNlr({
        document: doc,
        sceneId: "scene-a",
        resolveAssetUrl: (assetId: string) => `test://${assetId}`,
    } as Parameters<typeof compileStudioStoryToNlr>[0]);
    return (compiled.story as unknown as { entryScene: Scene }).entryScene;
}

const parallaxOf = (layer: Layer): number => (layer as unknown as { getParallax(): number }).getParallax();
const zIndexOf = (layer: Layer): number => (layer as unknown as { config: { zIndex: number } }).config.zIndex;

function layerNamed(scene: Scene, name: string): Layer {
    const layers = (scene as unknown as { config: { layers: Layer[] } }).config.layers;
    const layer = layers.find(l => (l as unknown as { config: { name: string } }).config.name === name);
    if (!layer) {
        throw new Error(`no layer ${name}`);
    }
    return layer;
}

describe("the scene's layers", () => {
    it("builds every layer of the stack at its share of the camera, empty ones included", async () => {
        const scene = await entryScene(document(STACK));
        expect(parallaxOf(layerNamed(scene, "fog"))).toBe(1.4);
        expect(parallaxOf(layerNamed(scene, "street"))).toBe(1);
        expect(parallaxOf(layerNamed(scene, "hills"))).toBe(0.3);
        expect(parallaxOf(scene.backgroundLayer)).toBe(0);
    });

    it("orders the engine's layers as the stack does", async () => {
        const scene = await entryScene(document(STACK));
        const fog = zIndexOf(layerNamed(scene, "fog"));
        const street = zIndexOf(layerNamed(scene, "street"));
        const hills = zIndexOf(layerNamed(scene, "hills"));
        expect(fog).toBeGreaterThan(0);
        expect(street).toBeLessThan(0);
        expect(hills).toBeLessThan(street);
        expect(hills).toBeGreaterThan(-1);
    });

    it("follows the stack edited in place on the same scene, as the editor's preview recompiles it", async () => {
        // The story service edits a scene object in place, so a compile that remembered the stack it
        // read the first time would keep showing it after the author changed it.
        const doc = document(STACK.map(layer => ({ ...layer })));
        await entryScene(doc);
        doc.scenes["scene-a"].layers = [
            { kind: "custom", id: "fog", name: "fog", follow: 1.2 },
            { kind: "displayable" },
            { kind: "custom", id: "hills", name: "hills", follow: 0.5 },
            { kind: "background", follow: 0.4 },
        ];
        const scene = await entryScene(doc);
        expect(parallaxOf(layerNamed(scene, "fog"))).toBe(1.2);
        expect(parallaxOf(layerNamed(scene, "hills"))).toBe(0.5);
        expect(parallaxOf(scene.backgroundLayer)).toBe(0.4);
    });
});
