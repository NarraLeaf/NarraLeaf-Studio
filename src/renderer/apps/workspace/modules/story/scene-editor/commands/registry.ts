import type { TranslationKey } from "@shared/i18n";
import { i18nStore, translate } from "@/lib/i18n";
import type { StoryCommandDef, StoryCommandParam } from "../storyCommandGrammar";
import type { StoryCommandParamsShape, StoryCommandSpec } from "./spec";
import { SCENE_COMMANDS } from "./specs/scene";
import { CHARACTER_COMMANDS } from "./specs/character";
import { OBJECT_COMMANDS } from "./specs/objects";
import { SOUND_COMMANDS } from "./specs/sound";
import { VARIABLE_COMMANDS } from "./specs/variables";
import { LOGIC_COMMANDS } from "./specs/logic";
import { EFFECT_COMMANDS } from "./specs/effects";
import { MISC_COMMANDS } from "./specs/misc";

/**
 * The command registry: every spec, aggregated, indexed, and projected onto the grammar shape the
 * pure pipeline layers consume.
 *
 * This replaces both halves of the old dual system - the P0 grammar table and the paramless
 * palette fall-through. Every command the line resolves is a spec here, and every commit runs the
 * same path; there is no second behaviour hiding behind `params.length === 0`.
 */

/** Erased spec - what the registry hands out. `build`/`validate` are called through the erased shape. */
export type AnyStoryCommandSpec = StoryCommandSpec<StoryCommandParamsShape>;

const ALL_SPECS: readonly AnyStoryCommandSpec[] = [
    ...SCENE_COMMANDS,
    ...CHARACTER_COMMANDS,
    ...OBJECT_COMMANDS,
    ...SOUND_COMMANDS,
    ...VARIABLE_COMMANDS,
    ...LOGIC_COMMANDS,
    ...EFFECT_COMMANDS,
    ...MISC_COMMANDS,
] as readonly AnyStoryCommandSpec[];

/** Project a spec's ordered params record onto the grammar's array shape (record key → param name). */
function specParams(spec: AnyStoryCommandSpec): readonly StoryCommandParam[] {
    return Object.entries(spec.params).map(([name, param]) => ({ name, ...param }));
}

function specToDef(spec: AnyStoryCommandSpec): StoryCommandDef {
    return {
        token: spec.token,
        commandId: spec.id,
        aliases: spec.aliases,
        params: specParams(spec),
    };
}

const DEFS: readonly StoryCommandDef[] = ALL_SPECS.map(specToDef);
const SPEC_BY_ID = new Map<string, AnyStoryCommandSpec>(ALL_SPECS.map(spec => [spec.id, spec]));
const DEF_BY_ID = new Map<string, StoryCommandDef>(DEFS.map(def => [def.commandId, def]));

// Duplicate ids or tokens are authoring mistakes worth failing loudly on, at import time.
if (SPEC_BY_ID.size !== ALL_SPECS.length) {
    throw new Error("Duplicate story command spec id.");
}
{
    const tokens = new Set<string>();
    for (const spec of ALL_SPECS) {
        for (const token of [spec.token, ...(spec.aliases ?? [])]) {
            if (tokens.has(token)) {
                throw new Error(`Duplicate story command token or alias: "${token}".`);
            }
            tokens.add(token);
        }
    }
}

/**
 * The i18n keys a command's menu label / detail read.
 *
 * The single anchor the whole feature turns on: the slash menu's label (`localizeSpecCommand`) and the
 * localized token the parser accepts (`localizedTokenMap`) both resolve through *these* keys, so a
 * Chinese token can never drift from the label the author sees. `/背景` parses to `bg` because "背景"
 * IS `bg`'s menu label in the active locale - not a second, hand-maintained alias list.
 */
export function commandLabelKey(id: string): TranslationKey {
    return `story.command.${id}.label` as TranslationKey;
}

export function commandDetailKey(id: string): TranslationKey {
    return `story.command.${id}.detail` as TranslationKey;
}

/** Every English spelling the parser already accepts for any command: canonical token, id, and aliases. */
function canonicalTokens(): ReadonlySet<string> {
    const tokens = new Set<string>();
    for (const def of DEFS) {
        tokens.add(def.token);
        tokens.add(def.commandId.toLowerCase());
        for (const alias of def.aliases ?? []) {
            tokens.add(alias);
        }
    }
    return tokens;
}

/**
 * The active locale's command labels, folded to a lookup key, mapped to their def: the "translated
 * name → canonical command" table the parser consults so `/背景` resolves to `bg`.
 *
 * Derived, never authored - it tracks the catalog and every locale for free, and only the command
 * *token* is localized (params and their values stay English; the ghost hint and resolver read the
 * canonical grammar). A localized token is additive, never a shadow: an entry is dropped when its
 * folded label is blank, contains whitespace (a multi-word label is not a single inline token), or
 * already spells a canonical English token, so the English pass in {@link getCommandDef} always wins
 * and existing behaviour is unchanged. A label two commands happen to share resolves to the first.
 *
 * Rebuilt when the locale changes - `translate` reads the active locale, so the cache is keyed on it -
 * and dropped whenever the i18n store notifies, so a plugin language pack that swaps the catalog under
 * a fixed locale re-localizes the parser in step with the menu (which re-renders on the same signal).
 */
let localizedTokens: { locale: string; map: ReadonlyMap<string, StoryCommandDef> } | null = null;
i18nStore.subscribe(() => {
    localizedTokens = null;
});

function localizedTokenMap(): ReadonlyMap<string, StoryCommandDef> {
    const locale = i18nStore.getLocale();
    if (localizedTokens?.locale === locale) {
        return localizedTokens.map;
    }
    const canonical = canonicalTokens();
    const map = new Map<string, StoryCommandDef>();
    for (const def of DEFS) {
        const key = commandLabelKey(def.commandId);
        const raw = translate(key);
        const label = raw.trim().toLowerCase();
        // `translate` echoes the key back on a missing entry - that is not a token. A blank or
        // multi-word label is not a single inline token either; a label already spelling a canonical
        // English token is handled by the English pass; a duplicate resolves to the first def.
        if (!label || raw === key || /\s/.test(label) || canonical.has(label) || map.has(label)) {
            continue;
        }
        map.set(label, def);
    }
    localizedTokens = { locale, map };
    return map;
}

export function listCommandSpecs(): readonly AnyStoryCommandSpec[] {
    return ALL_SPECS;
}

export function listCommandDefs(): readonly StoryCommandDef[] {
    return DEFS;
}

export function getCommandSpec(id: string): AnyStoryCommandSpec | null {
    return SPEC_BY_ID.get(id) ?? null;
}

export function getDefById(id: string): StoryCommandDef | null {
    return DEF_BY_ID.get(id) ?? null;
}

/**
 * Resolve a typed token to its command def: canonical token, then English alias, then the localized
 * alias (the active locale's menu label - `/背景` → `bg`), then the spec id.
 *
 * The English spellings are tried before the localized table by construction of that table, which
 * excludes any label already spelling a canonical token - so an ASCII `/bg` behaves identically in
 * every locale, and only a genuinely-translated token like `/背景` reaches the localized step.
 */
export function getCommandDef(token: string): StoryCommandDef | null {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    return DEFS.find(def => def.token === normalized)
        ?? DEFS.find(def => (def.aliases ?? []).includes(normalized))
        ?? localizedTokenMap().get(normalized)
        ?? DEFS.find(def => def.commandId.toLowerCase() === normalized)
        ?? null;
}
