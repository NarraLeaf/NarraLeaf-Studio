import type { StoryActionPayload, StoryAlignPositionValue, StoryBlock, StoryTransformProps } from "@shared/types/story";
import { clampToAlignReach } from "../commands/transformVocabulary";

export type PreviewCameraRowPayload = Extract<StoryActionPayload, { action: "camera" }>;

/**
 * The camera pose the preview's framing edits: where the stage's centre sits - a share of the stage
 * plus design pixels, from the bottom left, which is how the engine places the camera - and its zoom.
 */
export type PreviewCameraPose = { xalign: number; yalign: number; xoffset: number; yoffset: number; zoom: number };

/**
 * How far the wheel may push in or pull out. Below a tenth the stage is a speck in the frame; past
 * ten times a pixel of the design is ten of the screen. The row itself takes any zoom the command
 * line does; this only bounds what the wheel reaches.
 */
export const PREVIEW_CAMERA_ZOOM = { min: 0.1, max: 10 } as const;

/**
 * The camera row a framing on the preview writes: a camera transform that states a pose. A motion
 * plays a whole move and a reset states none, so neither has one pose to drag.
 */
export function previewCameraRowPayload(block: StoryBlock | undefined): PreviewCameraRowPayload | null {
    if (!block || block.kind !== "action" || block.disabled) {
        return null;
    }
    const payload = block.payload as StoryActionPayload;
    if (payload.action !== "camera" || payload.operation !== "transform" || payload.transform?.mode === "animation") {
        return null;
    }
    return payload;
}

const finite = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * The pose the camera holds once the row has played: the settled props the preview computed for it
 * (everything before the row with the row over it), with what the row states now laid over those -
 * the row may have just been written, before the preview has rebuilt from it. A camera nothing has
 * moved is centred at zoom 1.
 */
export function previewCameraPose(settled: Record<string, unknown> | null | undefined, row?: PreviewCameraRowPayload | null): PreviewCameraPose {
    const position = (settled?.position ?? {}) as Record<string, unknown>;
    const pose: PreviewCameraPose = {
        xalign: finite(position.xalign, 0.5),
        yalign: finite(position.yalign, 0.5),
        xoffset: finite(position.xoffset, 0),
        yoffset: finite(position.yoffset, 0),
        zoom: finite(settled?.zoom, 1),
    };
    const to = row?.transform?.to;
    const stated = (to?.position ?? {}) as StoryAlignPositionValue;
    return {
        xalign: finite(stated.xalign, pose.xalign),
        yalign: finite(stated.yalign, pose.yalign),
        xoffset: finite(stated.xoffset, pose.xoffset),
        yoffset: finite(stated.yoffset, pose.yoffset),
        zoom: finite(to?.zoom, pose.zoom),
    };
}

/** The props that put a pose on the camera, in the shape the preview poses it with. */
export function previewCameraProps(pose: PreviewCameraPose): Record<string, unknown> {
    return {
        position: { xalign: pose.xalign, yalign: pose.yalign, xoffset: pose.xoffset, yoffset: pose.yoffset },
        zoom: pose.zoom,
    };
}

/**
 * The pose with the picture moved by (dx, dy) screen pixels on a stage drawn `stage` pixels big: the
 * picture follows the pointer. The camera's position is where the stage's centre sits, so a larger
 * `xalign` moves the picture right and a larger `yalign` moves it up - and since the engine places
 * that point outside the zoom, a pixel of drag is the same share of the stage at any zoom.
 */
export function panPreviewCamera(pose: PreviewCameraPose, dx: number, dy: number, stage: { width: number; height: number }): PreviewCameraPose {
    return {
        ...pose,
        xalign: clampToAlignReach(pose.xalign + dx / Math.max(1, stage.width)),
        yalign: clampToAlignReach(pose.yalign - dy / Math.max(1, stage.height)),
    };
}

/**
 * The pose zoomed by `factor` about a point of the stage (screen pixels from its top left): what is
 * under the point stays under it, so pointing at a face and turning the wheel pushes in on the face.
 * The engine zooms about the camera's own point, so the point moves to keep the one under the pointer
 * still.
 */
export function zoomPreviewCameraAt(
    pose: PreviewCameraPose,
    factor: number,
    point: { x: number; y: number },
    stage: { width: number; height: number },
    design: { width: number; height: number },
): PreviewCameraPose {
    const zoom = Math.min(PREVIEW_CAMERA_ZOOM.max, Math.max(PREVIEW_CAMERA_ZOOM.min, pose.zoom * factor));
    const ratio = zoom / Math.max(1e-6, pose.zoom);
    const width = Math.max(1, stage.width);
    const height = Math.max(1, stage.height);
    const xShift = pose.xoffset / Math.max(1, design.width);
    const yShift = pose.yoffset / Math.max(1, design.height);
    // The camera's point on screen, from the stage's top left.
    const cx = (pose.xalign + xShift) * width;
    const cy = height - (pose.yalign + yShift) * height;
    const nx = point.x - ratio * (point.x - cx);
    const ny = point.y - ratio * (point.y - cy);
    return {
        ...pose,
        zoom,
        xalign: clampToAlignReach(nx / width - xShift),
        yalign: clampToAlignReach((height - ny) / height - yShift),
    };
}

const round = (value: number, places: number): number => Number(value.toFixed(places));

/**
 * The row with a pose written into it: the position as both shares - a row that states one prints no
 * position at all - with its offsets kept, and the zoom when it changed; rounded as the row prints
 * them, so what is stored is what the line says.
 */
export function withPreviewCameraPose(
    payload: PreviewCameraRowPayload,
    pose: PreviewCameraPose,
    changed: { position: boolean; zoom: boolean },
): PreviewCameraRowPayload {
    const transform = payload.transform ?? {};
    const to: StoryTransformProps = { ...(transform.to ?? {}) };
    if (changed.position) {
        to.position = { ...(to.position ?? {}), xalign: round(pose.xalign, 4), yalign: round(pose.yalign, 4) };
    }
    if (changed.zoom) {
        to.zoom = round(pose.zoom, 3);
    }
    return { ...payload, transform: { ...transform, to } };
}
