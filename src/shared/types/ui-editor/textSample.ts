/**
 * Sample text: the words an element holds where something else decides what the game shows.
 *
 * A text or a button whose words a value binding answers - a value blueprint, a list row's field - or
 * that a blueprint writes over while the game runs, still holds words of its own. No player reads
 * them. They are what the canvas draws while the page is laid out, so they are edited as sample text
 * and kept out of every translation table.
 *
 * Nothing is stored to say so. Whether an element's words are sample is read off the element and the
 * blueprint document each time (`uiTextSampleCauseOf`), so a binding made or a writer deleted is
 * reflected the moment it happens, and a document written before this existed needs no migration.
 *
 * The dialogue line and the NVL line have sample words by their site (`role: "sample"`); in their slot
 * the game draws the story's line in their place, and on any other page they show their own words.
 * They are not this module's: their site says it, and their words ship as they are.
 *
 * Comments in English per project convention.
 */

import type { UIElement } from "./document";
import { readUITextSite, type UITextSite } from "./textSource";
import type { UITextWriter } from "./textWriters";

/**
 * Why an element's words are sample text.
 *
 * - `blueprintValue`: a value blueprint answers them.
 * - `listItemField`: a field of the list row answers them; the canvas draws the list's own rows there.
 * - `written`: a blueprint replaces them while the game runs (`Set Text`, `Clear Text`, `Set Label`).
 */
export type UITextSampleCause = "blueprintValue" | "listItemField" | "written";

/**
 * Why an element's words on a site are sample text, or null when they are what a player reads.
 *
 * A translation key wins over all three, as it does in the game: the element's own words under a key
 * are the key's stored copy, which the game falls back to when the key cannot be read. A writer that
 * only appends keeps the element's own words - they are the start of what the game shows.
 *
 * `writers` are the element's own (`UITextWriterIndex.get(element.id)`).
 */
export function uiTextSampleCauseOf(
    element: UIElement,
    site: UITextSite,
    writers: readonly UITextWriter[] | undefined,
): UITextSampleCause | null {
    if (site.role !== "words") {
        return null;
    }
    const reading = readUITextSite(element, site);
    if (reading.key) {
        return null;
    }
    if (site.valueBinding !== "none") {
        if (reading.binding?.kind === "blueprintValue") {
            return "blueprintValue";
        }
        if (reading.binding?.kind === "listItemField") {
            return "listItemField";
        }
    }
    if (writers?.some(writer => writer.textProp === site.textProp && writer.effect === "replace")) {
        return "written";
    }
    return null;
}
