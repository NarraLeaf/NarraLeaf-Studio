/**
 * Font formats a player's machine cannot render, and what to convert each one to.
 *
 * Studio offers all of these in the font picker and refuses them on import, the same bargain
 * `.avi` and `.tif` get: a format that is hidden from the picker is one an author cannot be told
 * about, so they stay visible and are turned away with a sentence naming the way out.
 *
 * The list is one table because three places need the same answer and used to disagree. The editor's
 * `UIEditorFontFaceService` had it right and kept it to itself, so a file it would refuse to load
 * could still be imported and then sit on the project's font stack drawing nothing, with
 * `typography` lint reporting no problem. Measured 2026-08-21 in Electron 38 / Chromium 140:
 *
 * - **`ttc` / `otc`** - a collection holds several faces and `FontFace` takes one file to mean one
 *   typeface. `msgothic.ttc` and `simsun.ttc` fell back to the interface font while single-face
 *   `.ttf` cuts of the same typefaces loaded normally. Refused rather than extracted from: a
 *   collection typically carries a proportional, a fixed-pitch and a UI cut of one family, so taking
 *   the first face would silently hand the author one of three.
 * - **`svg`** - SVG fonts left Blink a decade ago. A minimal SVG 1.1 `<font>` was rejected as
 *   `Invalid font data in ArrayBuffer.` from a buffer, and as a network error from a blob URL.
 * - **`eot`** - Embedded OpenType, an Internet Explorer wrapper no other engine ever read.
 *
 * Comments in English per project convention.
 */

/** Extension (no dot, lower case) -> what an author should convert it to. */
export const UNRENDERABLE_FONT_FORMATS: Readonly<Record<string, string>> = {
    ttc: "a single-face .ttf or .otf",
    otc: "a single-face .ttf or .otf",
    eot: ".ttf or .otf",
    svg: ".ttf or .otf",
};

/**
 * Whether this extension names a font nothing can draw with.
 *
 * Takes the extension as the asset library stores it - no leading dot, any case - and tolerates
 * both, because the two callers get it from different places (a file name at import, an asset
 * record afterwards).
 */
export function isUnrenderableFontFormat(extension: string | undefined | null): boolean {
    if (!extension) {
        return false;
    }
    return normalizeFontExtension(extension) in UNRENDERABLE_FONT_FORMATS;
}

/** What to convert this format to, or null when it is one Studio can render. */
export function fontFormatConversionHint(extension: string | undefined | null): string | null {
    if (!extension) {
        return null;
    }
    return UNRENDERABLE_FONT_FORMATS[normalizeFontExtension(extension)] ?? null;
}

function normalizeFontExtension(extension: string): string {
    return extension.trim().toLowerCase().replace(/^\./, "");
}

/**
 * The format a font's own bytes declare, or null when they declare none this module knows.
 *
 * The extension is a *name*, and a name is the one thing an asset record is allowed not to have: a
 * library entry may be called `MaokenAssortedSans` with no dot in it and no `ext` field - the state
 * every asset written by something other than Studio's own import arrives in, and the state the
 * shipped skeleton's assets are already in. Guessing the format from that name yields `"unknown"`,
 * and every consumer downstream reads `"unknown"` as "a format we cannot draw", which is the
 * opposite of what the file is. So the bytes are asked first and the name is only the fallback.
 *
 * The four-byte tag at offset 0 is the sfnt/WOFF version field, and it is exactly what
 * `openFont` in `@shared/typography/fontCoverage` dispatches on - the same four constants, read the
 * same way, because there is one right answer to "what is this file" and two readers of it.
 *
 * `0x00010000` and `true` are TrueType outlines, `OTTO` is CFF - both are drawn by the same
 * `font/ttf` | `font/otf` pair and are told apart only so the `format()` hint written into the
 * `@font-face` rule matches the file. A collection (`ttcf`) is named rather than rejected here:
 * naming it is what lets the caller refuse it with the sentence
 * {@link UNRENDERABLE_FONT_FORMATS} carries.
 */
export function sniffFontFormat(bytes: Uint8Array | undefined | null): string | null {
    if (!bytes || bytes.length < 4) {
        return null;
    }
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (tag === "wOFF") {
        return "woff";
    }
    if (tag === "wOF2") {
        return "woff2";
    }
    if (tag === "ttcf") {
        return "ttc";
    }
    if (tag === "OTTO") {
        return "otf";
    }
    if (tag === "true" || tag === "typ1") {
        return "ttf";
    }
    // `0x00010000`, the version of a TrueType-outline sfnt. Read as four bytes rather than through
    // a DataView so this stays usable on a plain array of bytes from any host.
    if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
        return "ttf";
    }
    return null;
}
