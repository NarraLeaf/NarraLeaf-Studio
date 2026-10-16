import { describe, expect, it } from "vitest";
import { inheritedPosePortrait } from "./poseFraming";

/**
 * A second pose's dialog avatar, framed like the first.
 *
 * The tutorial's Narra: the default pose 默认 framed by hand on her face, a second pose 微笑 added
 * later on a picture of the same size and framed by nothing. The automatic crop put her ears and the
 * top of her head in the dialogue box for every 微笑 line.
 */
describe("inheritedPosePortrait", () => {
    const face = { x: 0.455, y: 0.01, w: 0.38, h: 0.35 };
    const elsewhere = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const sizes: Record<string, { width: number; height: number }> = {
        narra: { width: 1600, height: 1586 },
        smile: { width: 1600, height: 1586 },
        bust: { width: 800, height: 900 },
        sad: { width: 1600, height: 1586 },
    };
    const sizeOf = (assetId: string) => sizes[assetId];
    const poses = [
        { id: "p1oh", assetId: "narra", portrait: face },
        { id: "p17n", assetId: "smile" },
        { id: "bust", assetId: "bust" },
    ];

    it("frames an unframed pose like a framed pose of the same size", () => {
        expect(inheritedPosePortrait({ poses, defaultPoseId: "p1oh", poseId: "p17n", sizeOf })).toEqual(face);
    });

    it("leaves a picture of another size to the automatic crop", () => {
        expect(inheritedPosePortrait({ poses, defaultPoseId: "p1oh", poseId: "bust", sizeOf })).toBeUndefined();
    });

    it("inherits nothing for a pose with framing of its own, or while a size is not known", () => {
        expect(inheritedPosePortrait({ poses, defaultPoseId: "p1oh", poseId: "p1oh", sizeOf })).toBeUndefined();
        expect(inheritedPosePortrait({ poses, defaultPoseId: "p1oh", poseId: "p17n", sizeOf: () => null })).toBeUndefined();
        expect(inheritedPosePortrait({ poses, defaultPoseId: "p1oh", poseId: "missing", sizeOf })).toBeUndefined();
    });

    it("asks the default pose first, then the others in order", () => {
        const framedTwice = [
            { id: "sad", assetId: "sad", portrait: elsewhere },
            { id: "p17n", assetId: "smile" },
            { id: "p1oh", assetId: "narra", portrait: face },
        ];
        expect(inheritedPosePortrait({ poses: framedTwice, defaultPoseId: "p1oh", poseId: "p17n", sizeOf })).toEqual(face);
        expect(inheritedPosePortrait({ poses: framedTwice, defaultPoseId: null, poseId: "p17n", sizeOf })).toEqual(elsewhere);
    });
});
