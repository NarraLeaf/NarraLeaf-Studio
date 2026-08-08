/**
 * The stage a project is authored against.
 *
 * **A coordinate system, not a rendering resolution.** Nothing here decides how many pixels the
 * shipped game draws - the engine always fits its stage into whatever window it is given. What this
 * number does is fix the space every surface, every element position and every background is laid
 * out in, which is why it is asked once at creation and never offered as a setting afterwards: a
 * project that changed it would keep every layout it already had, at the wrong size.
 *
 * Kept in `shared` because both halves of the answer live apart: the wizard picks one, and a
 * bundled template declares which ones its own content was drawn for.
 */

export type StageSize = {
    width: number;
    height: number;
};

/**
 * Bounds a hand-typed size has to stay inside.
 *
 * The lower bound is roughly the smallest phone in CSS pixels; below it a dialogue box cannot hold
 * a line of text. The upper bound is 4K, which is already far past anything a visual novel is
 * authored at - past it the numbers stop describing a layout space and start describing a mistake.
 */
export const STAGE_SIZE_MIN = 320;
export const STAGE_SIZE_MAX = 3840;

/**
 * The sizes offered for a project with no template, landscape first.
 *
 * Landscape leads because visual novels overwhelmingly are, and the portrait entries exist because
 * the mobile shells can lock to it (`app.mobile.orientation`) - a project that plays upright was
 * simply not creatable before, since every preset here was 16:9.
 */
export const STAGE_SIZE_PRESETS: readonly StageSize[] = [
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3840, height: 2160 },
    { width: 1920, height: 1200 },
    { width: 1024, height: 768 },
    { width: 720, height: 1280 },
    { width: 1080, height: 1920 },
    { width: 1536, height: 2048 },
];

/** How a size is written where it is persisted and where it is used as an option value. */
export function stageSizeValue(size: StageSize): string {
    return `${size.width}x${size.height}`;
}

/** How a size is written to a reader. */
export function formatStageSize(size: StageSize): string {
    return `${size.width} × ${size.height}`;
}

/** Read back a persisted `WxH`, or null when it is not one. */
export function parseStageSize(value: string): StageSize | null {
    const match = /^(\d+)x(\d+)$/.exec(value.trim());
    if (!match) {
        return null;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!isStageSizeUsable({ width, height })) {
        return null;
    }
    return { width, height };
}

/** Whole numbers, inside the bounds. */
export function isStageSizeUsable(size: StageSize): boolean {
    return [size.width, size.height].every(
        side => Number.isInteger(side) && side >= STAGE_SIZE_MIN && side <= STAGE_SIZE_MAX,
    );
}

export function stageSizesEqual(a: StageSize, b: StageSize): boolean {
    return a.width === b.width && a.height === b.height;
}

/** Landscape covers square, because a square stage locks a phone the same way a wide one does. */
export function stageOrientation(size: StageSize): "landscape" | "portrait" {
    return size.height > size.width ? "portrait" : "landscape";
}

function greatestCommonDivisor(a: number, b: number): number {
    return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * The aspect as an author would say it: `16:9`, `4:3`, `9:16`.
 *
 * A hand-typed size usually reduces to nothing sayable - 1000 × 777 is 1000:777, which is not a
 * ratio anybody reads - so past a point it is written as a decimal instead. Either way this is a
 * readback beside the numbers, never a value anything is keyed on.
 */
export function formatStageAspectRatio(size: StageSize): string {
    if (size.width <= 0 || size.height <= 0) {
        return "";
    }
    const divisor = greatestCommonDivisor(size.width, size.height);
    const width = size.width / divisor;
    const height = size.height / divisor;
    if (width <= 64 && height <= 64) {
        return `${width}:${height}`;
    }
    return `${(size.width / size.height).toFixed(2)}:1`;
}
