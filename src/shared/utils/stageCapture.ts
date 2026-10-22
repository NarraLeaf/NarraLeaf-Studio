/**
 * A save's picture of the stage, read back from the compositor rather than drawn by the page.
 *
 * The page can picture its own stage only by cloning it: html-to-image copies every element and its
 * computed style, inlines every image as a data URL, wraps the lot in an SVG and rasterises that -
 * which decodes every background and sprite it inlined again, at full size. MEASURED in a 1920x1080
 * port on a 2x display: about 0.6 s of the main thread per picture even drawn at thumbnail size, a
 * stall the player sees whenever an auto-save takes one. The frame the player is looking at already
 * exists, composited; `webContents.capturePage` copies it out in the browser process. Five such
 * read-backs (through the DevTools protocol's equivalent) cost the same page one 73 ms frame between
 * them.
 *
 * So every desktop shell - the packaged game and the Dev Mode window - answers a save's picture this
 * way, and a page that cannot (the web export) keeps drawing its own. Two main processes reach for
 * this, as they do for `screenshotFile`; what they share is everything but the window.
 *
 * What a compositor picture shows is what is on the screen in that rectangle, so it includes
 * whatever is drawn over the stage at that moment. The page asks only when nothing should be: a
 * page opened over the stage still takes its cover picture the page's own way.
 *
 * Electron is injected, structurally, so this can be exercised without it.
 *
 * Comments in English per project convention.
 */

/** A rectangle of the page, in its CSS pixels. */
export type StageCaptureRect = { x: number; y: number; width: number; height: number };

export type StageCaptureRequest = {
    /** The stage, as the page measures it. */
    rect: StageCaptureRect;
    /** The longest edge of the picture, in pixels. Never scaled up. */
    maxEdge: number;
    /** JPEG quality on the 0-1 scale. */
    quality: number;
};

/**
 * Longest a capture is waited for. A window the compositor is not drawing - covered, minimised -
 * can leave `capturePage` unanswered; the page then pictures the stage its own way.
 */
export const STAGE_CAPTURE_TIMEOUT_MS = 2000;

/** The request as the main process accepts it: finite, positive, and nothing else. */
export function normalizeStageCaptureRequest(value: unknown): StageCaptureRequest | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const { rect, maxEdge, quality } = value as Partial<Record<keyof StageCaptureRequest, unknown>>;
    if (!rect || typeof rect !== "object") {
        return null;
    }
    const { x, y, width, height } = rect as Partial<Record<keyof StageCaptureRect, unknown>>;
    const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || !(width > 0) || !(height > 0)) {
        return null;
    }
    if (!finite(maxEdge) || !(maxEdge > 0) || !finite(quality)) {
        return null;
    }
    return {
        rect: { x, y, width, height },
        maxEdge: Math.round(maxEdge),
        quality: Math.min(1, Math.max(0, quality)),
    };
}

/**
 * The area `capturePage` takes, from a rectangle in the page's CSS pixels. The window's DIPs differ
 * from those by the page zoom - Studio's interface zoom applies to the Dev Mode window too. Rounded
 * outwards, so the stage's edge pixels are in the picture.
 */
export function stageCaptureArea(rect: StageCaptureRect, zoomFactor: number): StageCaptureRect {
    const zoom = zoomFactor > 0 ? zoomFactor : 1;
    const left = Math.max(0, Math.floor(rect.x * zoom));
    const top = Math.max(0, Math.floor(rect.y * zoom));
    const right = Math.ceil((rect.x + rect.width) * zoom);
    const bottom = Math.ceil((rect.y + rect.height) * zoom);
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** The part of Electron's `NativeImage` this needs. */
export type StageCaptureImage = {
    isEmpty(): boolean;
    getSize(): { width: number; height: number };
    resize(options: { width?: number; height?: number; quality?: "good" | "better" | "best" }): StageCaptureImage;
    toJPEG(quality: number): { toString(encoding: "base64"): string };
};

/** The part of Electron's `WebContents` this needs. */
export type StageCaptureContents = {
    capturePage(rect?: StageCaptureRect): Promise<StageCaptureImage>;
    getZoomFactor(): number;
};

/**
 * The stage as a JPEG data URL, scaled to fit `maxEdge`. Null when the window could not be read
 * back - empty, refused, or not answered within `timeoutMs` - so the page can fall back to its own.
 * Never rejects.
 */
export async function captureStageThumbnail(
    contents: StageCaptureContents,
    request: StageCaptureRequest,
    timeoutMs = STAGE_CAPTURE_TIMEOUT_MS,
): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const area = stageCaptureArea(request.rect, contents.getZoomFactor());
        const image = await Promise.race([
            contents.capturePage(area),
            new Promise<null>(resolve => {
                timer = setTimeout(() => resolve(null), timeoutMs);
            }),
        ]);
        if (!image || image.isEmpty()) {
            return null;
        }
        const size = image.getSize();
        const longest = Math.max(size.width, size.height);
        const fitted = longest > request.maxEdge
            ? image.resize(size.width >= size.height
                ? { width: request.maxEdge, quality: "good" }
                : { height: request.maxEdge, quality: "good" })
            : image;
        const base64 = fitted.toJPEG(Math.round(request.quality * 100)).toString("base64");
        return base64.length > 0 ? `data:image/jpeg;base64,${base64}` : null;
    } catch {
        return null;
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}
