import { describe, expect, it } from "vitest";
import type { StorySceneLayer } from "@shared/types/story";
import { layerStackDepths, layerSwayTransform, snapLayerFollow } from "./storyLayerStackModel";

const stack: StorySceneLayer[] = [
    { kind: "custom", id: "fog", name: "fog", follow: 1.4 },
    { kind: "displayable" },
    { kind: "custom", id: "street", name: "street" },
    { kind: "custom", id: "hills", name: "hills", follow: 0.3 },
    { kind: "background", follow: 0 },
];

describe("layerStackDepths", () => {
    it("draws each layer at its share less one, and spreads layers at one distance a step apart in stack order", () => {
        const depths = layerStackDepths(stack, 0.1);
        expect(depths[0]).toBeCloseTo(0.4);
        // The characters and the street both follow all of the camera: drawn either side of 0.
        expect(depths[1]).toBeCloseTo(0.05);
        expect(depths[2]).toBeCloseTo(-0.05);
        expect(depths[3]).toBeCloseTo(-0.7);
        expect(depths[4]).toBeCloseTo(-1);
    });
});

describe("snapLayerFollow", () => {
    it("settles on all of the camera, none of it, or another layer's share when it comes near", () => {
        expect(snapLayerFollow(stack, "custom:street", 0.98)).toBe(1);
        expect(snapLayerFollow(stack, "custom:street", 0.02)).toBe(0);
        expect(snapLayerFollow(stack, "custom:street", 0.32)).toBe(0.3);
        expect(snapLayerFollow(stack, "custom:street", 0.5)).toBe(0.5);
    });

    it("does not snap a layer to its own share", () => {
        expect(snapLayerFollow(stack, "custom:hills", 0.32)).toBe(0.32);
    });
});

describe("layerSwayTransform", () => {
    it("moves a layer by its share of the camera and leaves one that follows none of it still", () => {
        expect(layerSwayTransform(0, 0.05, 1.08, 200)).toBe("translate3d(0.00px, 0, 0) scale(1.0000)");
        expect(layerSwayTransform(1, 0.05, 1.08, 200)).toBe("translate3d(-10.00px, 0, 0) scale(1.0800)");
    });
});
