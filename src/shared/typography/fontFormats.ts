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
