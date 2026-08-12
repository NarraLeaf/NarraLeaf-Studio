import type { DocumentDiffEntry } from "@shared/documents/diff";
import { contentClassOfEntry } from "./entrySides";

/**
 * The decisions behind a type comparison, with no DOM in them.
 *
 * There are only two, and both are the kind that is quietly wrong on screen: which files this
 * draws, and what a loaded face is called while it is loaded.
 */

/** Whether this presenter draws that file. See {@link contentClassOfEntry}. */
export function isFontEntry(entry: DocumentDiffEntry): boolean {
    return contentClassOfEntry(entry) === "font";
}

/**
 * The sizes the specimen can be set at, in pixels.
 *
 * Four, spanning what a font in this product is actually used for: a menu label, body dialogue, a
 * chapter title and the size at which an author checks a curve. A continuous slider was not worth
 * it - nobody is looking for 27px - and the steps keep both sides at the same size, which a slider
 * per side would not.
 */
export const FONT_SAMPLE_SIZES: readonly number[] = [14, 20, 32, 56];

/** The size a specimen opens at: body text, which is what most of a font's work is. */
export const DEFAULT_FONT_SAMPLE_SIZE = 20;

let issued = 0;

/**
 * A family name nothing else in the document is using.
 *
 * Both sides of a comparison are the same typeface under the same family name as far as the file
 * is concerned, so they cannot both be installed under it: the second `FontFace` would win and
 * both specimens would draw the new version, which is the one failure this presenter must not
 * have. A counter also covers the pane being opened twice before the first one has finished
 * tidying up.
 */
export function nextFontFamily(): string {
    issued += 1;
    return `nl-vcs-specimen-${issued}`;
}
