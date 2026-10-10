/**
 * The arithmetic of an agent's screenshot: which part of the page, at what size.
 *
 * Kept apart from the rasteriser because it is the part that can be wrong silently - a crop that is
 * off by the editor's zoom still produces a picture, just of the wrong thing - and it is pure.
 *
 * Comments in English per project convention.
 */

export type ScreenshotRect = { x: number; y: number; width: number; height: number };

export type ScreenshotPlan = {
    /** The part of the page drawn, in design pixels. */
    source: ScreenshotRect;
    /** Output pixels per design pixel. */
    scale: number;
    /** The PNG's size. */
    width: number;
    height: number;
};

/**
 * How far a small crop is enlarged. A crop of one button at 1:1 is a 200-pixel picture a model reads
 * badly; doubling it costs nothing, since the page is re-rendered rather than scaled up.
 */
export const SCREENSHOT_MAX_UPSCALE = 2;

/**
 * The plan for a page of `design` size, cropped to `crop` (or whole when null), with its longer
 * edge at most `maxSize`. Null when the crop lies wholly outside the page.
 */
export function planScreenshot(
    design: { width: number; height: number },
    crop: ScreenshotRect | null,
    maxSize: number,
): ScreenshotPlan | null {
    const designWidth = Math.max(1, design.width);
    const designHeight = Math.max(1, design.height);
    const wanted = crop ?? { x: 0, y: 0, width: designWidth, height: designHeight };
    const left = clamp(wanted.x, 0, designWidth);
    const top = clamp(wanted.y, 0, designHeight);
    const right = clamp(wanted.x + wanted.width, 0, designWidth);
    const bottom = clamp(wanted.y + wanted.height, 0, designHeight);
    if (right - left < 1 || bottom - top < 1) {
        return null;
    }
    const source = { x: left, y: top, width: right - left, height: bottom - top };
    const limit = Math.max(16, Math.floor(maxSize));
    const longEdge = Math.max(source.width, source.height);
    const scale = Math.min(limit / longEdge, crop ? SCREENSHOT_MAX_UPSCALE : 1);
    return {
        source,
        scale,
        width: Math.max(1, Math.round(source.width * scale)),
        height: Math.max(1, Math.round(source.height * scale)),
    };
}

/**
 * An element's box in design pixels, from where the browser drew it and where it drew the page.
 *
 * Measured rather than read from the element's layout because the layout is relative to its parent
 * and may be flowed; the ratio of the page's drawn width to its design width undoes whatever zoom the
 * drawing went through (Studio's own interface zoom among them).
 */
export function designRectFromClientRects(
    pageRect: { left: number; top: number; width: number; height: number },
    elementRect: { left: number; top: number; width: number; height: number },
    design: { width: number; height: number },
): ScreenshotRect {
    const sx = pageRect.width > 0 ? design.width / pageRect.width : 1;
    const sy = pageRect.height > 0 ? design.height / pageRect.height : 1;
    return {
        x: (elementRect.left - pageRect.left) * sx,
        y: (elementRect.top - pageRect.top) * sy,
        width: elementRect.width * sx,
        height: elementRect.height * sy,
    };
}

/** A picture of `width` × `height` scaled so its longer edge is at most `maxSize`; never enlarged. */
export function fitWithin(width: number, height: number, maxSize: number): { width: number; height: number; scale: number } {
    const limit = Math.max(16, Math.floor(maxSize));
    const scale = Math.min(1, limit / Math.max(1, width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
