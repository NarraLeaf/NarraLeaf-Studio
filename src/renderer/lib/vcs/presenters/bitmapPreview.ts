import type { CSSProperties } from "react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import { contentClassOfEntry } from "./entrySides";

/**
 * The decisions behind an image comparison, with no React in them.
 *
 * Separated because each one is a claim that can be quietly wrong on screen and obvious in a
 * test: which files this presenter is entitled to draw, which bytes a browser will decode, which
 * comparisons two given images support, and at what scale each of them is drawn.
 */

/** Pixels, as an image reports them once decoded. */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

export type CompareMode = "side-by-side" | "swipe" | "difference";

/** Whether this presenter draws that file. See {@link contentClassOfEntry}. */
export function isBitmapEntry(entry: DocumentDiffEntry): boolean {
  return contentClassOfEntry(entry) === "bitmap";
}

/**
 * The media type to hand a `Blob`, or null for bytes no browser here will draw.
 *
 * Sniffed rather than taken from the file's name, which in this project usually has no extension,
 * and answered as a MEDIA TYPE rather than as a family: `contentClassOfBytes` says "bitmap" for a
 * TIFF, and a TIFF in an `<img>` is a broken-image icon. Null is what makes the difference between
 * a stated reason and that icon.
 *
 * The list is what Chromium decodes, which is not the same as what a bitmap can be: TIFF and the
 * HEIF stills are deliberately absent, because Chromium has no decoder for either.
 */
export function bitmapMediaType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // APNG too: it is a PNG with extra chunks, and the type is the same.
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return "image/gif";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  // "BM" is two bytes and two bytes are not evidence, so the four reserved bytes of the file
  // header come too - the same test `contentClassOfBytes` makes, for the same reason.
  if (
    ascii(bytes, 0, 2) === "BM" &&
    bytes.length >= 10 &&
    bytes[6] === 0 &&
    bytes[7] === 0 &&
    bytes[8] === 0 &&
    bytes[9] === 0
  ) {
    return "image/bmp";
  }
  if (
    ascii(bytes, 4, 4) === "ftyp" &&
    (ascii(bytes, 8, 4) === "avif" || ascii(bytes, 8, 4) === "avis")
  ) {
    return "image/avif";
  }
  // A Windows icon or cursor: the type field between two pairs of zeroes, with a count that is
  // never zero.
  if (
    bytes.length >= 6 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    (bytes[2] === 1 || bytes[2] === 2) &&
    bytes[3] === 0 &&
    bytes[4] > 0 &&
    bytes[5] === 0
  ) {
    return "image/x-icon";
  }
  return null;
}

/**
 * The comparisons two images support.
 *
 * Empty means there is nothing to compare - one side, or one side that could not be drawn - and
 * the caller draws the image it has rather than a control over a comparison that does not exist.
 *
 * **Difference needs the same pixels in the same places.** Two images of different sizes stretched
 * onto one frame differ almost everywhere, so the mode would light up the whole picture and mean
 * nothing; the honest answer is that this pair cannot be compared that way, and it is left out.
 */
export function comparableModes(
  before: PixelSize | null,
  after: PixelSize | null
): readonly CompareMode[] {
  if (!before || !after) {
    return [];
  }
  const alignable = before.width === after.width && before.height === after.height;
  return alignable ? ["side-by-side", "swipe", "difference"] : ["side-by-side", "swipe"];
}

/**
 * The box both sides are drawn inside: large enough for either, in each direction.
 *
 * This is what makes the two frames comparable at a glance. Scaled to fit their own frames, a
 * 1024 image and a 640 image are the same size on screen and the change that broke the author's
 * layout is invisible; scaled against one box, the smaller one is smaller.
 */
export function unionBox(before: PixelSize | null, after: PixelSize | null): PixelSize | null {
  if (!before) return after;
  if (!after) return before;
  return {
    width: Math.max(before.width, after.width),
    height: Math.max(before.height, after.height)
  };
}

/**
 * One image inside that box, centred, as a share of it.
 *
 * Percentages rather than pixels, so the pair rescales with the pane and neither side needs its
 * width measured: the frame carries the box's aspect ratio, so a share of the frame is the same
 * scale factor in both directions and the same one for both images.
 */
export function framedImageStyle(size: PixelSize, box: PixelSize): CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: `${(size.width / box.width) * 100}%`,
    height: `${(size.height / box.height) * 100}%`
  };
}

/**
 * How tall a frame is allowed to get, in pixels.
 *
 * A judgement rather than a measurement: a sprite sheet is several thousand pixels tall, and at
 * pane width an uncapped frame is a picture nobody can see the bottom of without scrolling past
 * the controls that change it.
 */
export const FRAME_MAX_HEIGHT = 420;

/**
 * The frame's own shape, so both sides' frames are one box however tall the box is.
 *
 * The cap is on the WIDTH, worked back through the aspect ratio, and it has to be: a max-height
 * beside an aspect ratio shortens the frame without shortening the images inside it, which are
 * sized as a share of it - the picture would be squashed rather than smaller. Both sides share one
 * box, so they share the cap, and the scale stays common to them.
 */
export function frameStyle(box: PixelSize): CSSProperties {
  return {
    aspectRatio: `${box.width} / ${box.height}`,
    maxWidth: `${Math.round((box.width / box.height) * FRAME_MAX_HEIGHT)}px`
  };
}

/**
 * The backdrop under an image with an alpha channel.
 *
 * Almost every sprite in a visual novel has one, and a flat colour behind it hides exactly what an
 * author is looking for: whether an edge is clean, whether a halo appeared, whether the cut-out
 * lost a limb. Built from the fill tokens, so it follows the theme like everything else.
 */
export const TRANSPARENCY_BACKDROP: CSSProperties = {
  backgroundColor: "rgb(var(--nl-surface-sunken))",
  backgroundImage: "repeating-conic-gradient(var(--nl-fill) 0% 25%, transparent 0% 50%)",
  backgroundSize: "16px 16px"
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) {
    return "";
  }
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index]);
  }
  return out;
}
