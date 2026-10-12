import { describe, expect, it } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import {
    panPreviewCamera,
    previewCameraLayerTransform,
    previewCameraPose,
    previewCameraRowPayload,
    withPreviewCameraPose,
    zoomPreviewCameraAt,
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

describe("panPreviewCamera", () => {
    it("moves the picture with the pointer, the same share of the stage at any zoom", () => {
        expect(panPreviewCamera(pose, 80, -45, stage)).toEqual({ ...pose, xalign: 0.6, yalign: 0.6 });
        expect(panPreviewCamera({ ...pose, zoom: 3 }, 80, 0, stage).xalign).toBeCloseTo(0.6);
    });

    it("stops where the command line does", () => {
        expect(panPreviewCamera(pose, 8000, 0, stage).xalign).toBe(2);
    });
});

describe("zoomPreviewCameraAt", () => {
    it("pushes in about the camera's own point when the pointer is on it", () => {
        const zoomed = zoomPreviewCameraAt(pose, 2, { x: 400, y: 225 }, stage, design);
        expect(zoomed.zoom).toBe(2);
        expect(zoomed.xalign).toBeCloseTo(0.5);
        expect(zoomed.yalign).toBeCloseTo(0.5);
    });

    it("keeps what is under the pointer under it", () => {
        // A point a quarter of the stage right of the centre, at zoom 1, is 200px of the picture from
        // the camera's point; at zoom 2 it is 400px, so the camera's point moves 200px left.
        const zoomed = zoomPreviewCameraAt(pose, 2, { x: 600, y: 225 }, stage, design);
        expect(zoomed.xalign).toBeCloseTo(0.25);
        const back = zoomPreviewCameraAt(zoomed, 0.5, { x: 600, y: 225 }, stage, design);
        expect(back.xalign).toBeCloseTo(0.5);
        expect(back.zoom).toBeCloseTo(1);
    });

    it("counts the row's offsets in the camera's point and keeps them", () => {
        const offset = { ...pose, xoffset: 192 };
        const zoomed = zoomPreviewCameraAt(offset, 2, { x: 480, y: 225 }, stage, design);
        expect(zoomed.xoffset).toBe(192);
        expect(zoomed.xalign).toBeCloseTo(0.5);
    });

    it("stops at the wheel's reach", () => {
        expect(zoomPreviewCameraAt(pose, 100, { x: 400, y: 225 }, stage, design).zoom).toBe(10);
        expect(zoomPreviewCameraAt(pose, 0.001, { x: 400, y: 225 }, stage, design).zoom).toBe(0.1);
    });
});

describe("withPreviewCameraPose", () => {
    it("writes both shares, keeps the offsets and the rest of the row, and rounds as the row prints", () => {
        const payload = {
            action: "camera",
            operation: "transform",
            transform: { to: { position: { xoffset: 160 }, rotation: 5 }, durationMs: 600 },
        } as PreviewCameraRowPayload;
        const next = withPreviewCameraPose(payload, { ...pose, xalign: 0.612345, yalign: 0.4, zoom: 1.23456 }, { position: true, zoom: false });
        expect(next.transform).toStrictEqual({ to: { position: { xoffset: 160, xalign: 0.6123, yalign: 0.4 }, rotation: 5 }, durationMs: 600 });
        expect(withPreviewCameraPose(payload, { ...pose, zoom: 1.23456 }, { position: false, zoom: true }).transform?.to?.zoom).toBe(1.235);
    });

    it("gives a row with no transform yet one that states the pose", () => {
        const bare = { action: "camera", operation: "transform" } as PreviewCameraRowPayload;
        expect(withPreviewCameraPose(bare, pose, { position: true, zoom: true }).transform).toStrictEqual({ to: { position: { xalign: 0.5, yalign: 0.5 }, zoom: 1 } });
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
