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
 * Shrinking afterwards is the fallback, not the way in. Drawing the stage at full size, encoding it as
 * a PNG, decoding it and drawing it again was most of what a picture cost - about half a second of the
 * main thread per save in a 1920x1080 game on a 2x display, every few seconds while an auto-save ring
 * ran, which the player saw as the text stalling. An engine that can draw the stage at a given size
 * (`LiveGame.captureImage`, narraleaf-react 1.5.1) is asked for the picture at the kept size and in the
 * kept encoding, and it goes into the save as it comes; {@link captureSavePicture} picks the way.
 *
 * Even drawn small, a picture the page draws itself costs most of a second: the clone and its
 * rasterisation do not shrink with the picture. A desktop shell reads the frame back from the
 * compositor instead ({@link readBackSavePicture}, `@shared/utils/stageCapture`), and the page draws
 * its own only where it cannot - the web export, or a window that gave no frame.
 *
 * Comments in English per project convention.
 */

import type { StageCaptureRequest } from "@shared/utils/stageCapture";

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

/** What `LiveGame.captureImage` takes. Declared here because engines before 1.5.1 have no such method. */
export type StageImageOptions = {
    maxEdge?: number;
    type?: string;
    quality?: number;
    backgroundColor?: string;
};

/** The two ways a running game can picture its stage; an engine before 1.5.1 has only the first. */
export type SavePictureSource = {
    capturePng?: () => Promise<string>;
    captureImage?: (options: StageImageOptions) => Promise<string>;
};

/** Whether `source` can picture its stage at all. */
export function canCaptureSavePicture(source: SavePictureSource): boolean {
    return typeof source.captureImage === "function" || typeof source.capturePng === "function";
}

/**
 * A picture already at the kept size in a kept encoding goes into the save as it is; anything else is
 * shrunk. Only a WebP or JPEG passes - every picture drawn at the kept size comes in one of the two,
 * and a full-size capture is always a PNG.
 */
export async function finishSavePicture(picture: string, codec: CaptureCodec = browserCaptureCodec): Promise<string> {
    if (picture.startsWith("data:image/webp") || picture.startsWith("data:image/jpeg")) {
        return picture;
    }
    return shrinkSaveCapture(picture, codec);
}

/**
 * The stage as a save keeps it: drawn straight at {@link SAVE_CAPTURE_MAX_EDGE} as WebP by an engine
 * that can, else captured full size and shrunk. A shell that cannot write WebP answers with a PNG at
 * the kept size, which {@link finishSavePicture} re-encodes - a small picture, so a cheap one.
 *
 * Rejects when the engine's capture does, or when `source` has no way to capture at all.
 */
export async function captureSavePicture(source: SavePictureSource, codec: CaptureCodec = browserCaptureCodec): Promise<string> {
    if (typeof source.captureImage === "function") {
        const picture = await source.captureImage({
            maxEdge: SAVE_CAPTURE_MAX_EDGE,
            type: "image/webp",
            quality: SAVE_CAPTURE_QUALITY,
            // Neither encoder keeps transparency, and the stage is drawn on black.
            backgroundColor: "#000",
        });
        return finishSavePicture(picture, codec);
    }
    if (typeof source.capturePng === "function") {
        return shrinkSaveCapture(await source.capturePng(), codec);
    }
    throw new Error("the game runtime does not support capturePng");
}

/** A shell's read-back of the stage (`GameAppHost.captureStage`). */
export type StageReadBack = (request: StageCaptureRequest) => Promise<string | null>;

/**
 * The stage read back from the compositor by the shell, at the kept size, or null when the shell
 * cannot, the stage is not laid out, or no frame came - the caller then draws its own. Never rejects.
 */
export async function readBackSavePicture(
    stage: Element | null | undefined,
    readBack: StageReadBack | undefined,
): Promise<string | null> {
    if (!readBack || !stage) {
        return null;
    }
    const box = stage.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) {
        return null;
    }
    try {
        const picture = await readBack({
            rect: { x: box.x, y: box.y, width: box.width, height: box.height },
            maxEdge: SAVE_CAPTURE_MAX_EDGE,
            quality: SAVE_CAPTURE_QUALITY,
        });
        return typeof picture === "string" && picture.startsWith("data:image/") ? picture : null;
    } catch {
        return null;
    }
}
