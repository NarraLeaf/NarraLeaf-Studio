/**
 * The picture a save keeps of the screen it was taken on, at the size a save screen draws it.
 *
 * The engine captures the stage as a PNG at the size it is drawn in the window, times the display's
 * pixel ratio (`LiveGame.capturePng`) - 1750x985 in a Dev Mode window, 2400x1350 or more in a full
 * screen game on a high-density display. Stored as it came, that picture was 99% of every save file:
 * a save record was 1.2-1.7 MB with it and 11 KB without, and with an auto-save ring writing every
 * few seconds a player's save folder grew by megabytes a minute. Yet a save's picture is only ever a
 * thumbnail. The largest one the starter project draws is a manual slot's, 454x255 in a 1920x1080
 * design; the auto-save rows draw theirs at 206x116.
 *
 * So the capture is scaled down so that its longer edge is at most {@link SAVE_CAPTURE_MAX_EDGE} and
 * re-encoded as WebP before it is written. 960 is twice the starter's largest thumbnail, which keeps
 * it sharp on a 2x display at the design size and on a full-screen 4K one, where that thumbnail is
 * drawn about 908 pixels wide. A save record with its picture comes to about 50 KB.
 *
 * WebP because it is a third the size of a JPEG of the same picture at the same quality, and every
 * shell the game ships in can read it. Not every one can write it - a canvas asked for a type it
 * cannot encode answers with a PNG - so an answer that is not WebP is taken as JPEG instead, which
 * all of them write. Whatever goes wrong on the way leaves the capture as it came: a save keeps the
 * picture it was given rather than losing it to an optimisation.
 *
 * Old saves are untouched. They are read as they were written - a data URL says what it holds - and a
 * save screen draws a large PNG as happily as a small WebP.
 *
 * Comments in English per project convention.
 */

/** The longest edge, in pixels, a save's picture is kept at. See the module comment. */
export const SAVE_CAPTURE_MAX_EDGE = 960;

/** The encoder quality, on the canvas's 0-1 scale: no visible artefacts at thumbnail size. */
export const SAVE_CAPTURE_QUALITY = 0.85;

export type CaptureSize = { width: number; height: number };

/** A drawing of the capture at its new size, ready to encode. */
export type CaptureCanvas = {
    toDataURL(type: string, quality?: number): string;
};

/** How a capture is decoded and redrawn. The browser's own in a game; a stand-in in a test. */
export type CaptureCodec = {
    /** Decode `capture` and draw it onto a fresh canvas of the size `sizeFor` picks for it. */
    redraw(capture: string, sizeFor: (natural: CaptureSize) => CaptureSize): Promise<CaptureCanvas>;
};

/** The size a capture of `natural` is kept at: scaled down to fit {@link SAVE_CAPTURE_MAX_EDGE}, never up. */
export function saveCaptureSize(natural: CaptureSize, maxEdge = SAVE_CAPTURE_MAX_EDGE): CaptureSize {
    const longest = Math.max(natural.width, natural.height);
    if (!(longest > maxEdge)) {
        return { width: Math.max(1, Math.round(natural.width)), height: Math.max(1, Math.round(natural.height)) };
    }
    const ratio = maxEdge / longest;
    return {
        width: Math.max(1, Math.round(natural.width * ratio)),
        height: Math.max(1, Math.round(natural.height * ratio)),
    };
}

const browserCaptureCodec: CaptureCodec = {
    async redraw(capture, sizeFor) {
        const image = new Image();
        image.src = capture;
        await image.decode();
        const size = sizeFor({ width: image.naturalWidth, height: image.naturalHeight });
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("no 2D canvas to redraw the save picture on");
        }
        // Neither encoder keeps transparency the way the PNG did, and the stage is drawn on black.
        context.fillStyle = "#000";
        context.fillRect(0, 0, size.width, size.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, size.width, size.height);
        return canvas;
    },
};

/**
 * The capture as a save should keep it: scaled to fit {@link SAVE_CAPTURE_MAX_EDGE} and re-encoded.
 *
 * Resolves to the capture as it came when anything on the way fails, or when the result would not be
 * smaller - this never costs a save its picture.
 */
export async function shrinkSaveCapture(capture: string, codec: CaptureCodec = browserCaptureCodec): Promise<string> {
    try {
        const canvas = await codec.redraw(capture, natural => saveCaptureSize(natural));
        let shrunk = canvas.toDataURL("image/webp", SAVE_CAPTURE_QUALITY);
        if (!shrunk.startsWith("data:image/webp")) {
            shrunk = canvas.toDataURL("image/jpeg", SAVE_CAPTURE_QUALITY);
        }
        if (!shrunk.startsWith("data:image/") || shrunk.length >= capture.length) {
            return capture;
        }
        return shrunk;
    } catch {
        return capture;
    }
}
