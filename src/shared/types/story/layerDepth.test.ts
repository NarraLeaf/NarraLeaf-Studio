import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "./document";
import {
    DEFAULT_STORY_LAYER_DEPTH,
    isBackgroundLayerDepthRow,
    isStoryLayerDepth,
    sceneLayerDepths,
    STORY_LAYER_DEPTHS,
    storyLayerDepthParallax,
} from "./layerDepth";

function layerRow(id: string, payload: Record<string, unknown>, extra: Partial<StoryBlock> = {}): StoryBlock {
    return { id, kind: "action", childrenIds: [], payload: { action: "layer", objectName: "", ...payload }, ...extra } as unknown as StoryBlock;
}

function sceneOf(blocks: StoryBlock[]): StoryScene {
    return {
        id: "s",
        name: "Scene",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    } as unknown as StoryScene;
}

describe("layer depth vocabulary", () => {
    it("lists every depth nearest first, with the default among them", () => {
        expect(STORY_LAYER_DEPTHS).toEqual(["near", "follow", "mid", "far", "farthest"]);
        expect(STORY_LAYER_DEPTHS).toContain(DEFAULT_STORY_LAYER_DEPTH);
    });

    it("shares a pan out less the farther a layer is, and not at all at the far end", () => {
        const shares = STORY_LAYER_DEPTHS.map(storyLayerDepthParallax);
        for (let index = 1; index < shares.length; index += 1) {
            expect(shares[index]).toBeLessThan(shares[index - 1]);
        }
        expect(storyLayerDepthParallax("follow")).toBe(1);
        expect(storyLayerDepthParallax("farthest")).toBe(0);
        expect(storyLayerDepthParallax("near")).toBeGreaterThan(1);
    });

    it("moves a layer with no depth, or one it does not recognise, with the camera", () => {
        expect(storyLayerDepthParallax(undefined)).toBe(1);
        expect(storyLayerDepthParallax("sideways" as never)).toBe(1);
        expect(isStoryLayerDepth("sideways")).toBe(false);
        expect(isStoryLayerDepth("toString")).toBe(false);
    });
});

describe("sceneLayerDepths", () => {
    it("reads a custom layer's depth off its create row, under its stage name", () => {
        const depths = sceneLayerDepths(sceneOf([
            layerRow("a", { operation: "create", objectName: " hills ", depth: "far" }),
            layerRow("b", { operation: "create", objectName: "overlay" }),
        ]));
        expect(depths.custom.get("hills")).toBe("far");
        expect(depths.custom.has("overlay")).toBe(false);
        expect(depths.background).toBeUndefined();
    });

    it("reads the background layer's depth off its own row, wherever it stands, the later one holding", () => {
        const depths = sceneLayerDepths(sceneOf([
            layerRow("a", { operation: "setDepth", target: { kind: "default", layer: "background" }, depth: "far" }),
            layerRow("b", { operation: "setDepth", target: { kind: "default", layer: "background" }, depth: "mid" }),
        ]));
        expect(depths.background).toBe("mid");
    });

    it("ignores a depth row aimed anywhere but the background layer, and rows that are switched off", () => {
        const depths = sceneLayerDepths(sceneOf([
            layerRow("a", { operation: "setDepth", target: { kind: "default", layer: "displayable" }, depth: "far" }),
            layerRow("b", { operation: "create", objectName: "mist", depth: "near" }, { disabled: true }),
        ]));
        expect(depths.background).toBeUndefined();
        expect(depths.custom.has("mist")).toBe(false);
    });

    it("tells the background depth row apart from every other layer row", () => {
        expect(isBackgroundLayerDepthRow(layerRow("a", { operation: "setDepth", target: { kind: "default", layer: "background" } }))).toBe(true);
        expect(isBackgroundLayerDepthRow(layerRow("b", { operation: "setZIndex", target: { kind: "default", layer: "background" } }))).toBe(false);
        expect(isBackgroundLayerDepthRow(layerRow("c", { operation: "setDepth", target: { kind: "custom", name: "hills" } }))).toBe(false);
    });
});
