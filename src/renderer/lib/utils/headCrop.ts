/**
 * Locates the head of a character sprite so thumbnails can frame the face
 * instead of whatever happens to sit at the centre of a tall full-body image.
 *
 * Character art is drawn head-up on a transparent background, so the alpha
 * silhouette is enough to go on: measure how far each row reaches horizontally
 * and the neck stands out as a valley between the head and the shoulders. What
 * cannot be used is how much the outline flares - real art widens gradually
 * from hair to shoulders to arms, with no step change to find.
 *
 * Every threshold is a ratio of the sprite's own silhouette, so the art can be
 * any size or framing. When there is no neck to find - a bust shot, a face
 * close-up, art on an opaque background - this reports nothing rather than
 * guessing, and the caller falls back to a top-anchored crop, which is already
 * about right for exactly those cases.
 */

/**
 * A square crop in pixel space, normalised against the image. `w` is a fraction
 * of the image width and `h` a fraction of its height, so the two differ
 * numerically even though they describe the same number of pixels.
 */
export type NormalizedCrop = {
    x: number;
    y: number;
    w: number;
    h: number;
};

/** Long-side resolution the silhouette is analysed at. */
const ANALYSIS_MAX = 220;
/** Below this alpha a pixel is background - high enough to shrug off soft glows and downscale bleed. */
const ALPHA_THRESHOLD = 32;
/** Rows with fewer opaque pixels than this fraction of the width are antialiasing dust. */
const ROW_NOISE_RATIO = 0.004;
/** The neck is searched for in this much of the silhouette, measured from the top. */
const NECK_SEARCH_RATIO = 0.5;
/** Narrowings this close to the top are hair wisps and ahoge, not the head ending. */
const MIN_HEAD_RATIO = 0.06;
/** How far below its widest row the outline must fall before the head counts as passed. */
const PEAK_DROP = 0.85;
/** The neck has to be at least this much narrower than the head to be a neck at all. */
const NECK_RATIO = 0.85;
/** Widening by this much again means the shoulders have started. */
const SHOULDER_RISE = 1.05;
/** Breathing room around the detected head. */
const HEAD_PADDING = 1.12;
const CACHE_LIMIT = 256;

type PixelBox = {
    x: number;
    y: number;
    w: number;
    h: number;
};

const cache = new Map<string, NormalizedCrop | null>();
const pending = new Map<string, Promise<NormalizedCrop | null>>();

/**
 * The cached crop for `url`, or `undefined` when it has not been analysed yet.
 * A `null` entry means no head was found and the caller should frame the image
 * from the top instead.
 */
export function peekHeadCrop(url: string): NormalizedCrop | null | undefined {
    return cache.get(url);
}

export function resolveHeadCrop(url: string): Promise<NormalizedCrop | null> {
    const cached = cache.get(url);
    if (cached !== undefined) {
        return Promise.resolve(cached);
    }

    const inFlight = pending.get(url);
    if (inFlight) {
        return inFlight;
    }

    const task = detectHeadCrop(url)
        .catch(() => null)
        .then(crop => {
            pending.delete(url);
            remember(url, crop);
            return crop;
        });
    pending.set(url, task);
    return task;
}

function remember(url: string, crop: NormalizedCrop | null): void {
    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next();
        if (!oldest.done) {
            cache.delete(oldest.value);
        }
    }
    cache.set(url, crop);
}

async function detectHeadCrop(url: string): Promise<NormalizedCrop | null> {
    const response = await fetch(url);
    const bitmap = await createImageBitmap(await response.blob());
    try {
        const pixels = readPixels(bitmap);
        if (!pixels) {
            return null;
        }
        return findHeadCrop(pixels.data, pixels.width, pixels.height);
    } finally {
        bitmap.close();
    }
}

function readPixels(bitmap: ImageBitmap): ImageData | null {
    const scale = Math.min(1, ANALYSIS_MAX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true }) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
    if (!context) {
        return null;
    }

    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
    if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(width, height);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/** Exported for tests: the whole decision, given raw RGBA pixels. */
export function findHeadCrop(data: Uint8ClampedArray, width: number, height: number): NormalizedCrop | null {
    const left = new Int32Array(height).fill(-1);
    const right = new Int32Array(height).fill(-1);
    const noiseFloor = Math.max(1, Math.round(width * ROW_NOISE_RATIO));

    let top = -1;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
        const base = y * width * 4;
        let rowLeft = -1;
        let rowRight = -1;
        let count = 0;
        for (let x = 0; x < width; x++) {
            if (data[base + x * 4 + 3] < ALPHA_THRESHOLD) continue;
            if (rowLeft < 0) rowLeft = x;
            rowRight = x;
            count++;
        }
        if (count < noiseFloor) continue;
        left[y] = rowLeft;
        right[y] = rowRight;
        if (top < 0) top = y;
        bottom = y;
    }
    if (top < 0) {
        return null;
    }

    const neck = findNeckRow(smoothWidths(left, right, top, bottom), top, bottom);
    if (neck < 0) {
        return null;
    }
    return toNormalizedSquare(boundRows(left, right, top, neck), width, height);
}

/** Row widths, averaged over their neighbours so a single ragged row cannot pass for a neck. */
function smoothWidths(left: Int32Array, right: Int32Array, top: number, bottom: number): Float64Array {
    const raw = new Float64Array(bottom + 1);
    for (let y = top; y <= bottom; y++) {
        raw[y] = right[y] >= 0 ? right[y] - left[y] + 1 : 0;
    }

    const smoothed = new Float64Array(bottom + 1);
    for (let y = top; y <= bottom; y++) {
        const from = Math.max(top, y - 1);
        const to = Math.min(bottom, y + 1);
        let sum = 0;
        for (let i = from; i <= to; i++) {
            sum += raw[i];
        }
        smoothed[y] = sum / (to - from + 1);
    }
    return smoothed;
}

/**
 * The row where the head ends, or -1 if the silhouette has no neck in it.
 *
 * A neck is a valley, so it needs all three of: a head above it, a narrowing,
 * and shoulders widening out again below. Demanding the rise is what stops a
 * figure that simply tapers downwards from reading as one enormous head.
 */
function findNeckRow(widths: Float64Array, top: number, bottom: number): number {
    const span = bottom - top + 1;
    const limit = Math.min(bottom, top + Math.round(span * NECK_SEARCH_RATIO));
    const minOffset = Math.max(2, Math.round(span * MIN_HEAD_RATIO));

    let peak = 0;
    let passedPeak = -1;
    for (let y = top; y <= limit; y++) {
        const value = widths[y];
        if (value <= 0) continue;
        if (peak > 0 && y - top >= minOffset && value < peak * PEAK_DROP) {
            passedPeak = y;
            break;
        }
        if (value > peak) {
            peak = value;
        }
    }
    if (passedPeak < 0) {
        return -1;
    }

    let neckRow = passedPeak;
    let neckWidth = widths[passedPeak];
    let rose = false;
    for (let y = passedPeak + 1; y <= limit; y++) {
        const value = widths[y];
        if (value <= 0) continue;
        if (value < neckWidth) {
            neckWidth = value;
            neckRow = y;
            continue;
        }
        if (value > neckWidth * SHOULDER_RISE) {
            rose = true;
            break;
        }
    }
    if (!rose || neckWidth > peak * NECK_RATIO) {
        return -1;
    }
    return neckRow;
}

function boundRows(left: Int32Array, right: Int32Array, from: number, to: number): PixelBox | null {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = -1;
    for (let y = from; y <= to; y++) {
        if (right[y] < 0) continue;
        if (left[y] < minX) minX = left[y];
        if (right[y] > maxX) maxX = right[y];
    }
    if (maxX < 0) {
        return null;
    }
    return { x: minX, y: from, w: maxX - minX + 1, h: to - from + 1 };
}

function toNormalizedSquare(box: PixelBox | null, width: number, height: number): NormalizedCrop | null {
    if (!box) {
        return null;
    }

    const size = Math.min(Math.max(box.w, box.h) * HEAD_PADDING, width, height);
    const x = clamp(box.x + box.w / 2 - size / 2, 0, width - size);
    const y = clamp(box.y + box.h / 2 - size / 2, 0, height - size);
    return { x: x / width, y: y / height, w: size / width, h: size / height };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
