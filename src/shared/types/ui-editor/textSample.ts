/**
 * Sample text: the words an element holds where a binding decides what the game shows.
 *
 * A text or a button whose words a value binding answers - a value blueprint, a list row's field, a
 * text parameter of its component - still holds words of its own. No player reads them. They are
 * what the canvas draws while the page is laid out, so they are edited as sample text, kept out of
 * every translation table, and left out of every package (`withoutUITextSamples`).
 *
 * Words a blueprint writes over while the game runs (`Set Text`, `Clear Text`, `Set Label` - see
 * `textWriters.ts`) are not sample text. They are the element's default value: the game shows them,
 * translated into the player's language, until the first write lands, so they ship and are translated
 * like any other words a player reads.
 *
 * Nothing is stored to say so. Whether an element's words are sample is read off the element each
 * time (`uiTextSampleCauseOf`), so a binding made or removed is reflected the moment it happens, and a
 * document written before this existed needs no migration.
 *
 * The dialogue line and the NVL line have sample words by their site (`role: "sample"`); in their slot
 * the game draws the story's line in their place, and on any other page they show their own words.
 * They are not this module's: their site says it, and their words ship as they are.
 *
 * Comments in English per project convention.
 */

import type { GameLocalizationBundle } from "../localization";
import type { UIDocument, UIElement } from "./document";
import { readUITextSite, uiTextSiteOf, uiTextUnitId, type UITextSite } from "./textSource";

/**
 * Why an element's words are sample text: which binding answers them.
 *
 * - `blueprintValue`: a value blueprint answers them.
 * - `listItemField`: a field of the list row answers them; the canvas draws the list's own rows there.
 * - `componentParam`: a text parameter of the component answers them; each placement draws its own
 *   value, and the element's own words are drawn only in the component's own editor.
 */
export type UITextSampleCause = "blueprintValue" | "listItemField" | "componentParam";

/**
 * Why an element's words on a site are sample text, or null when they are what a player reads.
 *
 * A translation key wins over all three, as it does in the game: a keyed element holds no words of
 * its own, so there is nothing to call sample. Who writes the words while the game runs does not
 * enter into it - words a blueprint writes over are the element's default value, which a player reads
 * until the first write.
 */
export function uiTextSampleCauseOf(element: UIElement, site: UITextSite): UITextSampleCause | null {
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
        if (reading.binding?.kind === "componentParam") {
            return "componentParam";
        }
    }
    return null;
}

/**
 * An element's props with its sample words taken out: the words emptied, and the marks on them
 * dropped. Null when there is nothing to take out.
 */
function strippedProps(element: UIElement, site: UITextSite): Record<string, unknown> | null {
    const props = (element.props ?? {}) as Record<string, unknown>;
    const holdsWords = typeof props[site.textProp] === "string" && props[site.textProp] !== "";
    const holdsMarks = site.marksProp !== undefined && props[site.marksProp] !== undefined;
    if (!holdsWords && !holdsMarks) {
        return null;
    }
    const next: Record<string, unknown> = { ...props, [site.textProp]: "" };
    if (site.marksProp) {
        delete next[site.marksProp];
    }
    return next;
}

/** What `withoutUITextSamples` took out: the document a package carries, and the units no longer read. */
export type UITextSampleStrip = {
    document: UIDocument;
    /** The `ui:<elementId>.<prop>` units of every element whose sample words were taken out. */
    unitIds: ReadonlySet<string>;
};

/**
 * The interface document a package carries: every element's sample words emptied.
 *
 * Emptied rather than deleted, because a widget reads a missing prop as its default words. The marks
 * go with the words they mark, and the translations of those words stay behind with them
 * (`withoutUITextSampleUnits`), so no translation of words nobody reads can take the place of what the
 * binding shows. Both element tables are read - the document's and every component definition's.
 *
 * Returns the input unchanged (same object) when nothing in it is sample text.
 */
export function withoutUITextSamples(document: UIDocument): UITextSampleStrip {
    const unitIds = new Set<string>();
    const stripTable = (table: Record<string, UIElement>): Record<string, UIElement> => {
        let out = table;
        for (const [id, element] of Object.entries(table)) {
            const site = uiTextSiteOf(element.type);
            if (!site || !uiTextSampleCauseOf(element, site)) {
                continue;
            }
            const props = strippedProps(element, site);
            if (!props) {
                continue;
            }
            if (out === table) {
                out = { ...table };
            }
            out[id] = { ...element, props };
            unitIds.add(uiTextUnitId(element.id, site.textProp));
        }
        return out;
    };
    const elements = stripTable(document.elements ?? {});
    let components = document.components;
    if (components) {
        const next = components.map(component => {
            const table = stripTable(component.elements ?? {});
            return table === component.elements ? component : { ...component, elements: table };
        });
        if (next.some((component, index) => component !== components![index])) {
            components = next;
        }
    }
    if (elements === document.elements && components === document.components) {
        return { document, unitIds };
    }
    return { document: { ...document, elements, ...(components ? { components } : {}) }, unitIds };
}

/**
 * A localization payload without the translations of sample words.
 *
 * A language file keeps a unit after the words it translated stopped being shown - an element's words
 * translated, then bound. The element no longer reads its unit, and the translation
 * of words nobody reads has no place in the package either.
 */
export function withoutUITextSampleUnits(
    localization: GameLocalizationBundle | undefined,
    unitIds: ReadonlySet<string>,
): GameLocalizationBundle | undefined {
    if (!localization || unitIds.size === 0) {
        return localization;
    }
    let changed = false;
    const tables: Record<string, Record<string, string>> = {};
    for (const [locale, table] of Object.entries(localization.tables ?? {})) {
        let kept = table;
        for (const unitId of unitIds) {
            if (unitId in kept) {
                if (kept === table) {
                    kept = { ...table };
                }
                delete kept[unitId];
            }
        }
        if (kept !== table) {
            changed = true;
        }
        tables[locale] = kept;
    }
    return changed ? { ...localization, tables } : localization;
}
