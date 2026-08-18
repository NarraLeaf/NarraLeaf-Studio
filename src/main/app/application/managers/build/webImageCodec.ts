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

window.__nlWebImageEncode = async function (base64, sourceType, lossless, quality) {
    try {
        const source = new Blob([decodeBase64(base64)], { type: sourceType });
        // premultiplyAlpha:"none" keeps partially transparent pixels exact;
        // colorSpaceConversion:"none" keeps the encoder from re-tagging colour
        // the caller has already established is plain sRGB.
        const bitmap = await createImageBitmap(source, {
            premultiplyAlpha: "none",
            colorSpaceConversion: "none",
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
 * Start a codec window. `scratchDir` is where the page file is written; it is
 * Studio's own storage, never the project, because this file is a property of
 * the running Studio rather than of anything the author made.
 */
export async function openWebImageCodec(scratchDir: string): Promise<WebImageCodec> {
  await fs.mkdir(scratchDir, { recursive: true });
  const pagePath = path.join(scratchDir, CODEC_PAGE_FILENAME);
  await fs.writeFile(pagePath, CODEC_PAGE_SOURCE, "utf-8");

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
      backgroundThrottling: false
    }
  });
  try {
    await window.loadFile(pagePath);
  } catch (error) {
    window.destroy();
    throw error;
  }

  let closed = false;
  return {
    async encode(request: WebImageEncodeRequest): Promise<WebImageEncodeResult | null> {
      if (closed) {
        throw new Error("The web image codec has been closed");
      }
      const call =
        `window.__nlWebImageEncode(${JSON.stringify(request.bytes.toString("base64"))},` +
        `${JSON.stringify(request.sourceType)},${request.lossless},${request.quality ?? 100})`;
      const response = (await window.webContents.executeJavaScript(call, true)) as PageResponse;
      if (!response?.ok) {
        // A decode or encode failure is about this one image (a format
        // Chromium will not take, a size past the canvas ceiling), never
        // about the build. The caller keeps the original and moves on.
        return null;
      }
      return {
        bytes: Buffer.from(response.bytes),
        verifiedLossless: response.verifiedLossless === true
      };
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      if (!window.isDestroyed()) {
        window.destroy();
      }
      await fs.rm(pagePath, { force: true }).catch(() => undefined);
    }
  };
}
