import type { StoryActionPayload, StoryAlignPositionValue, StoryBlock } from "@shared/types/story";

export type PreviewCameraRowPayload = Extract<StoryActionPayload, { action: "camera" }>;

/** The camera row the layer view's moving preview rests on: the selected row, when it states a pose. */
export type StoryPreviewCameraApi = {
    blockId: string;
    payload: PreviewCameraRowPayload;
};

/**
 * A camera pose as the moving preview draws it: where the stage's centre sits - a share of the stage
 * plus design pixels, from the bottom left, which is how the engine places the camera - its zoom and
 * its rotation.
 */
export type PreviewCameraPose = { xalign: number; yalign: number; xoffset: number; yoffset: number; zoom: number; rotation: number };

/**
 * The camera row the moving preview can rest on: a camera transform that states a pose. A motion
 * plays a whole move and a reset states none, so neither has one shot to show.
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
 * the row may have just been edited, before the preview has rebuilt from it. A camera nothing has
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
        rotation: finite(settled?.rotation, 0),
    };
    const to = row?.transform?.to;
    const stated = (to?.position ?? {}) as StoryAlignPositionValue;
    return {
        xalign: finite(stated.xalign, pose.xalign),
        yalign: finite(stated.yalign, pose.yalign),
        xoffset: finite(stated.xoffset, pose.xoffset),
        yoffset: finite(stated.yoffset, pose.yoffset),
        zoom: finite(to?.zoom, pose.zoom),
        rotation: finite(to?.rotation, pose.rotation),
    };
}

/**
 * Where a layer of the framing preview sits for a camera pose, the preview drawn `stage` pixels big:
 * moved by its share of the camera's shift and zoomed by its share of the camera's zoom - the
 * engine's parallax (narraleaf-react `cameraParallax.ts`), the camera's point being where the stage's
 * centre lands. A layer that follows all of the camera is exactly the camera's own transform.
 */
export function previewCameraLayerTransform(
    follow: number,
    pose: PreviewCameraPose,
    stage: { width: number; height: number },
    design: { width: number; height: number },
): string {
    const shiftX = (pose.xalign - 0.5 + pose.xoffset / Math.max(1, design.width)) * stage.width;
    const shiftY = -(pose.yalign - 0.5 + pose.yoffset / Math.max(1, design.height)) * stage.height;
    const scale = Math.max(0.05, 1 + follow * (pose.zoom - 1));
    return `translate3d(${(follow * shiftX).toFixed(2)}px, ${(follow * shiftY).toFixed(2)}px, 0) rotate(${pose.rotation}deg) scale(${scale.toFixed(4)})`;
}
