import fs from "fs/promises";
import path from "path";
import { BrowserWindow } from "electron";

/**
 * WebP encoding for the web export, borrowed from the browser engine Studio is
 * already built on.
 *
 * There is no WebP encoder reachable from Node here - `nativeImage` writes PNG
 * and JPEG only - so this drives Chromium's, through a hidden window. That is a
 * strange-looking dependency for a build step, so it is worth writing down why
 * it is the right one: libwebp is what every browser decodes the output with, it
 * ships with Electron on all three platforms, and it costs no native module, no
 * prebuilt binary per architecture and no download. The alternative was a wasm
 * codec and its own copy of the same library.
 *
 * Two details are load-bearing and were established by measurement, not by
 * reading documentation:
 *
 * 1. **The image never touches a 2D context.** A `CanvasRenderingContext2D`
 *    stores premultiplied colour, so reading it back divides colour by alpha and
 *    quantizes - on a test image sweeping every alpha value, that route
 *    corrupted 48,412 of 262,144 channel bytes, some by the full 255. Going
 *    through `bitmaprenderer` with an `ImageBitmap` decoded
 *    `premultiplyAlpha: "none"` is byte-for-byte exact on the same input.
 * 2. **Quality 1 means lossless, not "quality 100".** Blink switches its WebP
 *    encoder to lossless mode only at exactly 1.0; anything below is lossy at
 *    that fraction.
 *
 * Neither is asserted from here. Every lossless encode is decoded again and
 * compared pixel for pixel inside the page, and the caller is told whether that
 * comparison passed - so a future Chromium that changes either behaviour makes
 * the pipeline stop converting, not start corrupting.
 */

/** The source formats the page is asked to decode. Sniffed from bytes by the caller. */
export type WebImageSourceType = "image/png" | "image/jpeg";

export type WebImageEncodeRequest = {
    bytes: Buffer;
    sourceType: WebImageSourceType;
    /** Lossless mode. When false, `quality` (1-100) applies. */
    lossless: boolean;
    quality?: number;
    /**
     * Decode the source straight to this size, in pixels, instead of its own.
     *
     * Only ever set for a lossy request, and only smaller than the source: a resized image is not
     * the image it came from, so there would be nothing left for a lossless round trip to verify.
     * The caller works the target out from the source's own dimensions, because the page is handed
     * bytes and is not the place to decide what an image is allowed to become.
     */
    resizeTo?: { width: number; height: number };
};

export type WebImageEncodeResult = {
    bytes: Buffer;
    /**
     * Whether the encoded bytes decode to exactly the source pixels. Always
     * checked for a lossless request and always false for a lossy one, where the
     * whole point is that they do not.
     */
    verifiedLossless: boolean;
};

export type WebImageCodec = {
    /** The encoded image, or null when this image could not be converted at all. */
    encode(request: WebImageEncodeRequest): Promise<WebImageEncodeResult | null>;
    close(): Promise<void>;
};

/**
 * The page the encoding runs in.
 *
 * It is loaded from a real file rather than a `data:` URL because WebCodecs'
 * `ImageDecoder` - the only way to read decoded pixels back *without* a
 * premultiplied round trip, and therefore the only way to verify losslessness -
 * requires a secure context, and a `data:` URL is not one. `file://` is.
 */
const CODEC_PAGE_FILENAME = "web-export-codec.html";

const CODEC_PAGE_SOURCE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>NarraLeaf web export codec</title></head>
<body>
<script>
"use strict";
function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Unpremultiplied RGBA of an encoded image, via WebCodecs. */
async function decodedPixels(blob, type) {
    const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: type });
    try {
        const decoded = await decoder.decode();
        const frame = decoded.image;
        try {
            const buffer = new Uint8Array(frame.allocationSize({ format: "RGBA" }));
            await frame.copyTo(buffer, { format: "RGBA" });
            return buffer;
        } finally {
            frame.close();
        }
    } finally {
        decoder.close();
    }
}

function identical(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

window.__nlWebImageEncode = async function (base64, sourceType, lossless, quality, resizeTo) {
    try {
        const source = new Blob([decodeBase64(base64)], { type: sourceType });
        // premultiplyAlpha:"none" keeps partially transparent pixels exact;
        // colorSpaceConversion:"none" keeps the encoder from re-tagging colour
        // the caller has already established is plain sRGB.
        //
        // A resize is asked of createImageBitmap rather than done afterwards, and that is not a
        // shortcut. The alternative - drawing into a 2D context and reading it back - stores
        // premultiplied alpha, and undoing that multiplication destroys partially transparent
        // pixels: measured at 48412 corrupted bytes out of 262144 on an image whose alpha runs the
        // full range. This path never has premultiplied pixels in it at all.
        const bitmap = await createImageBitmap(source, {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
            ...(resizeTo ? {
                resizeWidth: resizeTo.width,
                resizeHeight: resizeTo.height,
                resizeQuality: "high",
            } : {}),
        });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext("bitmaprenderer").transferFromImageBitmap(bitmap);
        const encoded = await canvas.convertToBlob({
            type: "image/webp",
            quality: lossless ? 1 : quality / 100,
        });
        const bytes = new Uint8Array(await encoded.arrayBuffer());
        let verifiedLossless = false;
        if (lossless) {
            verifiedLossless = identical(
                await decodedPixels(source, sourceType),
                await decodedPixels(encoded, "image/webp"),
            );
        }
        // The typed array survives executeJavaScript's structured clone intact,
        // and does so ~34x faster than the plain number array it would otherwise
        // be flattened into (1ms against 34ms for a 900 KB result).
        return { ok: true, bytes: bytes, verifiedLossless: verifiedLossless };
    } catch (error) {
        return { ok: false, message: String(error && error.message ? error.message : error) };
    }
};
</script>
</body>
</html>
`;

type PageResponse =
    | { ok: true; bytes: Uint8Array; verifiedLossless: boolean }
    | { ok: false; message: string };

/**
 * Start the codec: one hidden window now, and up to `pages` of them as the work calls for them.
 *
 * Each window is a renderer process of its own, so each encodes on its own cores, and an `encode`
 * that finds every window busy opens another rather than queueing - until there are `pages`, after
 * which it waits for the first to come free. How many encodes run at once is the caller's to decide
 * by how many it asks for at once; the pool only makes sure each has a page to run in. A caller that
 * awaits one image at a time gets one window, exactly as before.
 *
 * The first window opens here, before this resolves, so a host that cannot open one at all - no GPU
 * sandbox, a headless machine - finds out at the same point it always did. A later window that will
 * not open stops the pool growing and nothing else: the windows already open carry on.
 *
 * `scratchDir` is where the page file is written; it is Studio's own storage, never the project,
 * because this file is a property of the running Studio rather than of anything the author made.
 * Every window loads the same file.
 */
export async function openWebImageCodec(
    scratchDir: string,
    options: { pages?: number } = {},
): Promise<WebImageCodec> {
    const capacity = Math.max(1, Math.floor(options.pages ?? 1));
    await fs.mkdir(scratchDir, { recursive: true });
    const pagePath = path.join(scratchDir, CODEC_PAGE_FILENAME);
    await fs.writeFile(pagePath, CODEC_PAGE_SOURCE, "utf-8");

    type CodecPage = { window: BrowserWindow; busy: boolean };
    const pages: CodecPage[] = [];
    const waiting: Array<(page: CodecPage) => void> = [];
    let opening = 0;
    let growthStopped = false;
    let closed = false;

    try {
        pages.push({ window: await openCodecWindow(pagePath), busy: false });
    } catch (error) {
        await fs.rm(pagePath, { force: true }).catch(() => undefined);
        throw error;
    }

    const acquire = async (): Promise<CodecPage> => {
        const idle = pages.find(page => !page.busy);
        if (idle) {
            idle.busy = true;
            return idle;
        }
        if (!growthStopped && pages.length + opening < capacity) {
            opening += 1;
            try {
                const window = await openCodecWindow(pagePath);
                if (closed) {
                    window.destroy();
                    throw new Error("The web image codec has been closed");
                }
                const page = { window, busy: true };
                pages.push(page);
                return page;
            } catch (error) {
                if (closed) {
                    throw error;
                }
                // A machine that ran out of room for another renderer still has the ones it
                // opened; this encode waits its turn on them like any other.
                growthStopped = true;
            } finally {
                opening -= 1;
            }
        }
        return new Promise(resolve => {
            waiting.push(resolve);
        });
    };
    const release = (page: CodecPage): void => {
        const next = waiting.shift();
        if (next) {
            // Handed straight on, still marked busy, so no other caller can take it in between.
            next(page);
            return;
        }
        page.busy = false;
    };

    return {
        async encode(request: WebImageEncodeRequest): Promise<WebImageEncodeResult | null> {
            if (closed) {
                throw new Error("The web image codec has been closed");
            }
            const page = await acquire();
            try {
                return await encodeIn(page.window, request);
            } finally {
                release(page);
            }
        },
        async close(): Promise<void> {
            if (closed) {
                return;
            }
            closed = true;
            for (const page of pages) {
                if (!page.window.isDestroyed()) {
                    page.window.destroy();
                }
            }
            await fs.rm(pagePath, { force: true }).catch(() => undefined);
        },
    };
}

async function openCodecWindow(pagePath: string): Promise<BrowserWindow> {
    const window = new BrowserWindow({
        show: false,
        webPreferences: {
            // No Node, no preload, no remote content: the page's whole job is to
            // call two web APIs on bytes it is handed.
            nodeIntegration: false,
            contextIsolation: false,
            sandbox: false,
            // A hidden window is a background window, and Chromium throttles
            // those. The encode itself runs off-thread and would survive it, but
            // the promise plumbing around it does not need the extra latency.
            backgroundThrottling: false,
        },
    });
    try {
        await window.loadFile(pagePath);
    } catch (error) {
        window.destroy();
        throw error;
    }
    return window;
}

async function encodeIn(
    window: BrowserWindow,
    request: WebImageEncodeRequest,
): Promise<WebImageEncodeResult | null> {
    const call = `window.__nlWebImageEncode(${JSON.stringify(request.bytes.toString("base64"))},`
        + `${JSON.stringify(request.sourceType)},${request.lossless},${request.quality ?? 100},`
        + `${request.resizeTo ? JSON.stringify(request.resizeTo) : "null"})`;
    const response = await window.webContents.executeJavaScript(call, true) as PageResponse;
    if (!response?.ok) {
        // A decode or encode failure is about this one image (a format
        // Chromium will not take, a size past the canvas ceiling), never
        // about the build. The caller keeps the original and moves on.
        return null;
    }
    return {
        bytes: Buffer.from(response.bytes),
        verifiedLossless: response.verifiedLossless === true,
    };
}
