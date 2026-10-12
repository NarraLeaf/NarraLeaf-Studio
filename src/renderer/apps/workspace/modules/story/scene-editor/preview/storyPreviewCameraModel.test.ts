import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import {
    previewCameraLayerTransform,
    previewCameraPose,
    previewCameraRowPayload,
    type PreviewCameraRowPayload,
} from "./storyPreviewCameraModel";

const row = (payload: Record<string, unknown>, disabled = false) => ({ id: "r", kind: "action", payload, ...(disabled ? { disabled } : {}) }) as unknown as StoryBlock;
const pose = { xalign: 0.5, yalign: 0.5, xoffset: 0, yoffset: 0, zoom: 1, rotation: 0 };
const stage = { width: 800, height: 450 };
const design = { width: 1920, height: 1080 };

describe("previewCameraRowPayload", () => {
    it("takes a camera transform that states a pose, and nothing else", () => {
        expect(previewCameraRowPayload(row({ action: "camera", operation: "transform", transform: { to: { zoom: 1.2 } } }))).not.toBeNull();
        expect(previewCameraRowPayload(row({ action: "camera", operation: "transform", transform: { mode: "animation", animationId: "push" } }))).toBeNull();
        expect(previewCameraRowPayload(row({ action: "camera", operation: "reset" }))).toBeNull();
        expect(previewCameraRowPayload(row({ action: "camera", operation: "transform", transform: {} }, true))).toBeNull();
        expect(previewCameraRowPayload(row({ action: "show", target: {} }))).toBeNull();
    });
});

describe("previewCameraPose", () => {
    it("reads the settled pose, with what the row states now laid over it", () => {
        expect(previewCameraPose(null)).toEqual(pose);
        const settled = { position: { xalign: 0.3, yalign: 0.6, xoffset: 20 }, zoom: 1.5 };
        expect(previewCameraPose(settled)).toEqual({ xalign: 0.3, yalign: 0.6, xoffset: 20, yoffset: 0, zoom: 1.5, rotation: 0 });
        const written = { action: "camera", operation: "transform", transform: { to: { position: { xalign: 0.7, yalign: 0.4 }, zoom: 2 } } } as PreviewCameraRowPayload;
        expect(previewCameraPose(settled, written)).toEqual({ xalign: 0.7, yalign: 0.4, xoffset: 20, yoffset: 0, zoom: 2, rotation: 0 });
    });
});

describe("previewCameraLayerTransform", () => {
    it("moves and zooms a layer by its share of the camera, and leaves one that follows none of it still", () => {
        const moved = { ...pose, xalign: 0.6, zoom: 1.5 };
        expect(previewCameraLayerTransform(1, moved, stage, design)).toBe("translate3d(80.00px, 0.00px, 0) rotate(0deg) scale(1.5000)");
        expect(previewCameraLayerTransform(0.5, moved, stage, design)).toBe("translate3d(40.00px, 0.00px, 0) rotate(0deg) scale(1.2500)");
        expect(previewCameraLayerTransform(0, moved, stage, design)).toBe("translate3d(0.00px, 0.00px, 0) rotate(0deg) scale(1.0000)");
    });

    it("counts the row's offsets in design pixels, and an upward yalign as upward", () => {
        expect(previewCameraLayerTransform(1, { ...pose, xoffset: 192, yalign: 0.6 }, stage, design)).toBe("translate3d(80.00px, -45.00px, 0) rotate(0deg) scale(1.0000)");
    });
});
