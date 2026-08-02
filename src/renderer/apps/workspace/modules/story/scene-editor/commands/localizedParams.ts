import { SOURCE_LOCALE, type TranslationKey } from "@shared/i18n";
import { commandI18nStore, translateCommand } from "@/lib/i18n";
import { findParam, paramHintKey, type StoryCommandDef, type StoryCommandParam } from "../storyCommandGrammar";

/**
 * The localized spelling of a parameter key: the "translated name → param" table that lets an author
 * who sees `<位置>` type `位置=left` and have it mean `at=left`.
 *
 * The exact counterpart of `localizedTokenMap` in `registry.ts`, one layer down. Commands solved this
 * in the same way and for the same reason: the word the menu shows and the word the parser accepts
 * must be one word, or the hint is teaching a language the parser does not speak. Before this, the
 * inline ghost said `<位置>` while the only spelling that parsed was `at` — the same slot with two
 * names, one of them unusable.
 *
 * Derived, never authored: the label comes from `story.paramHint.<key>`, exactly the key the ghost,
 * the candidate menu and the manual read. A translation edit moves all four together and no alias
 * list can go stale.
 *
 * **Additive, never a shadow.** An entry is dropped when its folded label is blank, echoes its key
 * (missing translation — `translate` returns the key on a miss), contains whitespace (a multi-word
 * label like "Var Name" or "Pan / Zoom / …" is not a single inline token), or already spells a
 * canonical `name`/alias on this def. So `at=` behaves identically in every locale, and only a
 * genuinely translated word reaches this table.
 *
 * **Keyed per def, not globally.** `story.paramHint.*` is a deduplicated namespace shared across
 * commands — `duration` and `seekTime` both read "Seconds" — while param names are per-command. One
 * global table would make a slot resolve to whichever command declared it first. Two params of the
 * SAME def landing on one label resolve to the first, matching the command table's policy.
 */

type LocalizedParamCache = {
    locale: string;
    byDef: Map<StoryCommandDef, ReadonlyMap<string, StoryCommandParam>>;
};

let cache: LocalizedParamCache | null = null;
commandI18nStore.subscribe(() => {
    cache = null;
});

/** Every English spelling this def's parser pass already accepts. */
function canonicalKeys(def: StoryCommandDef): ReadonlySet<string> {
    const keys = new Set<string>();
    for (const param of def.params) {
        keys.add(param.name.toLowerCase());
        for (const alias of param.aliases ?? []) {
            keys.add(alias.toLowerCase());
        }
    }
    return keys;
}

function buildMap(def: StoryCommandDef): ReadonlyMap<string, StoryCommandParam> {
    const canonical = canonicalKeys(def);
    const map = new Map<string, StoryCommandParam>();
    for (const param of def.params) {
        const key = `story.paramHint.${paramHintKey(param)}` as TranslationKey;
        const raw = translateCommand(key);
        const label = raw.trim().toLowerCase();
        if (!label || raw === key || /\s/.test(label) || canonical.has(label) || map.has(label)) {
            continue;
        }
        map.set(label, param);
    }
    return map;
}

function localizedParamMap(def: StoryCommandDef): ReadonlyMap<string, StoryCommandParam> {
    const locale = commandI18nStore.getLocale();
    if (cache?.locale !== locale) {
        cache = { locale, byDef: new Map() };
    }
    const existing = cache.byDef.get(def);
    if (existing) {
        return existing;
    }
    const built = buildMap(def);
    cache.byDef.set(def, built);
    return built;
}

/**
 * Named-param lookup that also accepts the active command locale's spelling.
 *
 * English first, by construction of the table above — an ASCII `at=` never reaches the localized step,
 * so a script written in one locale keeps parsing in every other. This is what the parser calls;
 * {@link findParam} remains the pure, locale-free lookup for anything that must not see a locale.
 */
export function findParamLocalized(def: StoryCommandDef, key: string): StoryCommandParam | null {
    const direct = findParam(def, key);
    if (direct) {
        return direct;
    }
    return localizedParamMap(def).get(key.trim().toLowerCase()) ?? null;
}

/**
 * The spelling the candidate menu inserts for this slot: this locale's word when it has one that
 * parses, else the canonical key.
 *
 * The twin of `localizedEnumValue`, and there for the same reason: a menu that shows 转场 and writes
 * `t=` is showing a word it will not type. Whatever comes back is a key of the table
 * {@link findParamLocalized} reads, so the line it produces always parses back to this same slot.
 */
export function localizedParamKey(def: StoryCommandDef, param: StoryCommandParam): string {
    // In the source locale the canonical key IS the word — `at=`, `d=`. The English hint beside them
    // ("Position", "Seconds") is a DESCRIPTION of the slot, not a second name for it, and it only
    // doubles as a name in a locale that has no other word to offer. Inserting `Seconds=1` for an
    // English author would be replacing their key with its own caption.
    if (commandI18nStore.getLocale() === SOURCE_LOCALE) {
        return param.name;
    }
    const key = `story.paramHint.${paramHintKey(param)}` as TranslationKey;
    const raw = translateCommand(key).trim();
    return localizedParamMap(def).get(raw.toLowerCase()) === param ? raw : param.name;
}

/**
 * Whether a param answers to what the author has typed so far, in the candidate menu's `k=` position.
 *
 * Has to know the localized spelling too: the menu shows "位置" beside `at`, and a filter that only
 * matched `at`/`pos` would empty the list the moment the author typed the word they were just shown.
 * Matching is prefix-based, like the canonical pass it extends.
 */
export function paramMatchesQuery(def: StoryCommandDef, param: StoryCommandParam, query: string): boolean {
    if (!query) {
        return true;
    }
    const folded = query.trim().toLowerCase();
    if (param.name.toLowerCase().startsWith(folded)) {
        return true;
    }
    if ((param.aliases ?? []).some(alias => alias.toLowerCase().startsWith(folded))) {
        return true;
    }
    for (const [label, candidate] of localizedParamMap(def)) {
        if (candidate === param && label.startsWith(folded)) {
            return true;
        }
    }
    return false;
}
