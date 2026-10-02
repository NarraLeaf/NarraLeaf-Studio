/**
 * The translations nodes bring for their own words, gathered as the nodes register.
 *
 * Only a node the host did not define carries any (see `BlueprintNodeDeclaration.translations`);
 * the host's own words are in Studio's catalogue. Indexed by English text and then by locale,
 * because that is how every reader asks: `blueprintNodeI18n` is handed a title or a label, not the
 * node that declared it.
 *
 * One English string has one translation per locale. When two nodes declare different wordings for
 * the same string, the one registered last is used - the rule the host's own table keeps, where a
 * key is a piece of English text rather than a node.
 */

import type { BlueprintNodeDeclaration } from "./types";

const byText = new Map<string, Map<string, string>>();

/** Record a node's translations. A node without any, or with a malformed table, adds nothing. */
export function indexBlueprintNodeTranslations(translations: BlueprintNodeDeclaration["translations"]): void {
    if (!translations || typeof translations !== "object") {
        return;
    }
    for (const [locale, table] of Object.entries(translations)) {
        if (!table || typeof table !== "object") {
            continue;
        }
        for (const [english, text] of Object.entries(table)) {
            if (typeof text !== "string" || !text.trim()) {
                continue;
            }
            let locales = byText.get(english);
            if (!locales) {
                locales = new Map();
                byText.set(english, locales);
            }
            locales.set(locale, text);
        }
    }
}

/** The translation a node declared for `english` in `locale`, if any did. */
export function lookupBlueprintNodeTranslation(english: string, locale: string): string | undefined {
    return byText.get(english)?.get(locale);
}
