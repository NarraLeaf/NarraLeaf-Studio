import type { PortraitCrop } from "./types";

/**
 * The arithmetic around the head detector: where a sprite lands in the model's input, how its
 * output reads back onto the sprite, and the avatar framing a head box becomes.
 *
 * Pure, so the geometry is tested without a canvas or the WebAssembly runtime; `headDetector.ts`
 * does the drawing and the inference. The model and its input contract are described in
 * `resources/ml/head-detect/README.md`.
 */

/** Edge of the model's square input, in pixels. */
export const HEAD_DETECT_INPUT_PX = 640;

/** The score a box needs to count as a head: the model card's F1-optimal threshold. */
export const HEAD_DETECT_THRESHOLD = 0.365;

/** Room left around a head box when it becomes an avatar, as a factor of its longer side. */
export const HEAD_FRAME_PADDING = 1.12;

/** Grey the model was trained with around a letterboxed picture. */
export const LETTERBOX_FILL = 114;

/** Where a `width` x `height` picture is drawn inside the model's input. */
export type Letterbox = {
    scale: number;
    /** Left and top of the drawn picture, in input pixels. */
    offsetX: number;
    offsetY: number;
    drawWidth: number;
    drawHeight: number;
};

export function letterbox(width: number, height: number, input = HEAD_DETECT_INPUT_PX): Letterbox {
    const scale = Math.min(input / width, input / height);
    const drawWidth = Math.max(1, Math.round(width * scale));
    const drawHeight = Math.max(1, Math.round(height * scale));
    return {
        scale,
        offsetX: Math.floor((input - drawWidth) / 2),
        offsetY: Math.floor((input - drawHeight) / 2),
        drawWidth,
        drawHeight,
    };
}

/** A detected head, in the picture's own pixels. */
export type HeadBox = { score: number; x0: number; y0: number; x1: number; y1: number };

/**
 * The best-scoring head in the model's output, mapped back onto the picture, or null when nothing
 * clears {@link HEAD_DETECT_THRESHOLD}.
 *
 * `output` is the `[1, 5, anchors]` tensor laid out channel-major: centre x, centre y, width and
 * height of every anchor, then every anchor's score. The best box alone is what an avatar needs, so
 * there is no suppression pass - a sprite with two people in it frames the more certain one.
 */
export function bestHead(output: ArrayLike<number>, anchors: number, box: Letterbox): HeadBox | null {
    let best = -1;
    let bestScore = HEAD_DETECT_THRESHOLD;
    for (let index = 0; index < anchors; index++) {
        const score = output[4 * anchors + index];
        if (score >= bestScore) {
            bestScore = score;
            best = index;
        }
    }
    if (best < 0) {
        return null;
    }
    const cx = output[best], cy = output[anchors + best];
    const w = output[2 * anchors + best], h = output[3 * anchors + best];
    const back = (value: number, offset: number) => (value - offset) / box.scale;
    return {
        score: bestScore,
        x0: back(cx - w / 2, box.offsetX),
        y0: back(cy - h / 2, box.offsetY),
        x1: back(cx + w / 2, box.offsetX),
        y1: back(cy + h / 2, box.offsetY),
    };
}

/**
 * The avatar framing for a head: a square on the box's longer side with {@link HEAD_FRAME_PADDING}
 * around it, kept inside the picture, normalised the way every portrait crop is.
 *
 * Square in the picture's pixels because that is what the bake letterboxes into and what the
 * author's own drag produces; normalised, `w` and `h` therefore differ unless the picture is square.
 */
export function headFrame(head: HeadBox, width: number, height: number, padding = HEAD_FRAME_PADDING): PortraitCrop {
    const cx = (head.x0 + head.x1) / 2;
    const cy = (head.y0 + head.y1) / 2;
    const size = Math.min(Math.max(head.x1 - head.x0, head.y1 - head.y0) * padding, width, height);
    const x = Math.min(Math.max(cx - size / 2, 0), width - size);
    const y = Math.min(Math.max(cy - size / 2, 0), height - size);
    return { x: x / width, y: y / height, w: size / width, h: size / height };
}

/**
 * RGBA pixels of the drawn input to the model's float tensor: channel-major RGB in 0-1.
 * Alpha is ignored - the drawing composited the picture onto white before this reads it.
 */
export function toInputTensor(rgba: ArrayLike<number>, input = HEAD_DETECT_INPUT_PX): Float32Array {
    const plane = input * input;
    const tensor = new Float32Array(3 * plane);
    for (let index = 0; index < plane; index++) {
        tensor[index] = rgba[index * 4] / 255;
        tensor[plane + index] = rgba[index * 4 + 1] / 255;
        tensor[2 * plane + index] = rgba[index * 4 + 2] / 255;
    }
    return tensor;
}
