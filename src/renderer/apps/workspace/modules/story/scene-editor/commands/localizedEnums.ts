import type { TranslationKey } from "@shared/i18n";
import { commandI18nStore, translateCommand } from "@/lib/i18n";
import { matchEnumOption, type StoryCommandEnumOption, type StoryCommandParamType } from "../storyCommandGrammar";

type EnumType = Extract<StoryCommandParamType, { kind: "enum" }>;

/**
 * The localized spelling of an enum value: the table that lets an author who reads `t=淡变` type it.
 *
 * The third of three, exactly matching `registry.ts`'s command table and `localizedParams.ts`'s param
 * table — and the last hole in the sentence. Until this existed a Chinese author could type the verb
 * and the key in their own language and then had to switch back to English for the value, which is
 * the one place a half-translated line is *silently* wrong rather than loudly wrong: `t=渐隐` is not
 * an error the parser can name, it is just a word no option matches.
 *
 * Derived, never authored: the label comes from `story.enumValue.<canonical>`, the same key the
 * candidate menu shows. A translation edit moves the menu and the parser together.
 *
 * **Additive, never a shadow.** The same five drop rules as its two siblings — an entry is dropped
 * when its folded label is blank, echoes its key (untranslated — `translate` returns the key on a
 * miss), contains whitespace (not a single inline token), already spells a canonical value or alias
 * in THIS option set, or duplicates one already taken. So `t=fade` behaves identically in every
 * locale, and a script written in one parses in all of them.
 *
 * **Keyed per option set, not globally.** `story.enumValue.*` is one flat namespace shared across
 * commands, while the legal values are per-param: `darken` (a camera operation) and `darkness` (a
 * transition) are both 压暗 in Chinese, and only a per-set table keeps that from making one of them
 * unreachable. Two values of the SAME set landing on one label resolve to the first, matching the
 * policy of the other two tables.
 *
 * Storage is untouched: {@link matchEnumOptionLocalized} returns the canonical option, so resolution
 * banks the canonical English value however the author spelled it.
 */

type LocalizedEnumCache = {
    locale: string;
    bySet: Map<readonly StoryCommandEnumOption[], ReadonlyMap<string, StoryCommandEnumOption>>;
};

let cache: LocalizedEnumCache | null = null;
commandI18nStore.subscribe(() => {
    cache = null;
});

/** Every English spelling this option set already accepts. */
function canonicalValues(options: readonly StoryCommandEnumOption[]): ReadonlySet<string> {
    const values = new Set<string>();
    for (const option of options) {
        values.add(option.value.toLowerCase());
        for (const alias of option.aliases ?? []) {
            values.add(alias.toLowerCase());
        }
    }
    return values;
}

/**
 * Every author-facing spelling an option answers to, most-preferred first.
 *
 * Two sources, and both are ACCEPTED: the word the inspector shows for this option
 * ({@link StoryCommandEnumOption.labelKey}) and the vocabulary's own `story.enumValue.*` word. The
 * first is what the menus display, so the two surfaces read alike; the second is what an author may
 * already have typed, and dropping it would break lines that parse today.
 */
function spellingsOf(option: StoryCommandEnumOption): string[] {
    const keys = [option.labelKey, `story.enumValue.${option.value}`].filter(Boolean) as string[];
    return keys
        .map(key => ({ key, raw: translateCommand(key as TranslationKey) }))
        .filter(entry => entry.raw !== entry.key)
        .map(entry => entry.raw.trim())
        .filter(Boolean);
}

function buildMap(options: readonly StoryCommandEnumOption[]): ReadonlyMap<string, StoryCommandEnumOption> {
    const canonical = canonicalValues(options);
    const map = new Map<string, StoryCommandEnumOption>();
    for (const option of options) {
        for (const spelling of spellingsOf(option)) {
            const label = spelling.toLowerCase();
            if (/\s/.test(label) || canonical.has(label) || map.has(label)) {
                continue;
            }
            map.set(label, option);
        }
    }
    return map;
}

function mapFor(type: EnumType): ReadonlyMap<string, StoryCommandEnumOption> {
    const locale = commandI18nStore.getLocale();
    if (cache?.locale !== locale) {
        cache = { locale, bySet: new Map() };
    }
    const existing = cache.bySet.get(type.options);
    if (existing) {
        return existing;
    }
    const built = buildMap(type.options);
    cache.bySet.set(type.options, built);
    return built;
}

/**
 * Resolve an author-typed enum value to its option: the canonical English pass first, then this
 * locale's spelling.
 *
 * English first by construction as well as by order — the table above excludes anything already
 * spelling a canonical value — so an ASCII `t=fade` behaves identically whatever the command language
 * is. Use this everywhere {@link matchEnumOption} was used from the command pipeline; the bare
 * `matchEnumOption` stays the pure, locale-free lookup, as `findParam` does for params.
 */
export function matchEnumOptionLocalized(type: EnumType, raw: string): StoryCommandEnumOption | null {
    return matchEnumOption(type, raw) ?? mapFor(type).get(raw.trim().toLowerCase()) ?? null;
}

/**
 * The spelling the candidate menu should show and insert for this option: this locale's word when it
 * has one that parses, else the canonical value.
 *
 * Shown AND inserted, deliberately the same call — a menu that displays 淡变 and inserts `fade` teaches
 * a word it never types. Whatever comes back is a key of the table {@link matchEnumOptionLocalized}
 * reads, so it always round-trips.
 */
export function localizedEnumValue(type: EnumType, option: StoryCommandEnumOption): string {
    const table = mapFor(type);
    // First spelling that survived the drop rules for THIS option — the inspector's word when it has
    // one, else the vocabulary's own. Whatever comes back is a key of the accept table, so the menu
    // still shows only what it would take back.
    for (const spelling of spellingsOf(option)) {
        if (table.get(spelling.toLowerCase()) === option) {
            return spelling;
        }
    }
    return option.value;
}
