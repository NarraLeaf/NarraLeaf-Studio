import { describe, expect, it } from "vitest";
import type { StorySceneLayer } from "@shared/types/story";
import { STORY_LAYER_DISTANCE_MAX } from "@shared/types/story";
import { layerDepthAt, layerDistanceAtDepth, layerStackDepths, layerSwayTransform, roundLayerDistance } from "./storyLayerStackModel";

const stack: StorySceneLayer[] = [
    { kind: "custom", id: "fog", name: "fog", follow: 2 },
    { kind: "displayable" },
    { kind: "custom", id: "street", name: "street" },
    { kind: "custom", id: "hills", name: "hills", follow: 0.25 },
    { kind: "background", follow: 0 },
];

describe("layerDepthAt", () => {
    it("draws the characters at 0, nearer layers in front and farther ones behind", () => {
        expect(layerDepthAt(1)).toBe(-0);
        expect(layerDepthAt(0.5)).toBeCloseTo(Math.log(2));
        expect(layerDepthAt(2)).toBeLessThan(0);
        expect(layerDepthAt(10)).toBeLessThan(layerDepthAt(2));
    });

    it("draws a layer that does not move a step behind the farthest one that does", () => {
        expect(layerDepthAt(Infinity)).toBeLessThan(layerDepthAt(STORY_LAYER_DISTANCE_MAX));
    });

    it("reads back the distance it draws", () => {
        for (const distance of [0.5, 0.8, 1, 2, 3.5, 12, 60]) {
            expect(layerDistanceAtDepth(layerDepthAt(distance))).toBeCloseTo(distance, 6);
        }
        expect(layerDistanceAtDepth(layerDepthAt(Infinity))).toBe(Infinity);
    });
});

describe("layerStackDepths", () => {
    it("draws the layers of one level on one plane", () => {
        const depths = layerStackDepths(stack);
        expect(depths[1]).toBe(depths[2]);
        expect(depths[0]).toBeGreaterThan(depths[1]);
        expect(depths[3]).toBeLessThan(depths[2]);
        expect(depths[4]).toBe(layerDepthAt(Infinity));
    });
});

describe("roundLayerDistance", () => {
    it("rounds a dragged distance to the step its size reads in", () => {
        expect(roundLayerDistance(0.734)).toBe(0.75);
        expect(roundLayerDistance(2.37)).toBe(2.4);
        expect(roundLayerDistance(6.8)).toBe(7);
        expect(roundLayerDistance(17.4)).toBe(17);
        expect(roundLayerDistance(43)).toBe(45);
        expect(roundLayerDistance(Infinity)).toBe(Infinity);
    });
});

describe("layerSwayTransform", () => {
    it("moves a layer by its share of the camera and leaves one that follows none of it still", () => {
        expect(layerSwayTransform(0, 0.05, 1.08, 200)).toBe("translate3d(0.00px, 0, 0) scale(1.0000)");
        expect(layerSwayTransform(1, 0.05, 1.08, 200)).toBe("translate3d(-10.00px, 0, 0) scale(1.0800)");
    });
});
