import { createTranslator, getLocaleRegistryVersion, listOverlayLocales, SOURCE_LOCALE, SUPPORTED_LOCALES, type TranslationKey } from "@shared/i18n";
import { commandI18nStore, translateCommand } from "@/lib/i18n";
import type { StoryCommandDef, StoryCommandParam } from "../storyCommandGrammar";
import type { StoryCommandParamsShape, StoryCommandSpec } from "./spec";
import { SCENE_COMMANDS } from "./specs/scene";
import { CHARACTER_COMMANDS } from "./specs/character";
import { OBJECT_COMMANDS } from "./specs/objects";
import { SOUND_COMMANDS } from "./specs/sound";
import { VARIABLE_COMMANDS } from "./specs/variables";
import { LOGIC_COMMANDS } from "./specs/logic";
import { TRANSFORM_COMMANDS } from "./specs/transform";
import { VFX_COMMANDS } from "./specs/vfx";
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
    ...TRANSFORM_COMMANDS,
    ...VFX_COMMANDS,
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

/**
 * Every retired command, keyed by the id it had, spelling out the tokens it burned: canonical first,
 * aliases after.
 *
 * A token is not just a name, it is what a stored line RE-PARSES as. `invalid` rows keep the author's
 * source text verbatim, the script codec round-trips scenes through their command lines, and both
 * paths re-run the parser over text written years ago. So handing a dead token to a new command does
 * not free a name - it silently reinterprets every old line that still spells it, as the new
 * command's semantics, with no diagnostic anywhere. `/code` (schema v13) is the first of these: the
 * block kind is gone, and a `/code typescript` line left in a project must keep failing to resolve
 * rather than one day meaning something.
 *
 * `/save` and `/global` (with their aliases) joined on the same reasoning when the two project-scope
 * declarations were retired in favour of the variable registry. `/save` is the sharpest case in the
 * set: the obvious next meaning for that word is "write a save file", and a scene exported to a
 * script file years ago still holds `/save gold 10 type=number` lines that the importer re-parses
 * verbatim. Handing the token to a save-triggering command would turn every one of those old
 * declarations into a runtime action, silently.
 *
 * Keyed by ID rather than kept as a flat word list because of the one thing a retired command can
 * still be asked: what its ROWS read back as ({@link retiredCommandToken}). `/code` left none behind
 * and is here only to burn its words; the two declarations left plenty.
 */
const RETIRED_COMMAND_TOKENS: ReadonlyMap<string, readonly [string, ...string[]]> = new Map([
    ["code", ["code", "script"]],
    ["declareVar", ["save", "var", "savedvar"]],
    ["declarePersis", ["global", "persis", "persistent"]],
    // M2's six, plus the token that briefly replaced two of them. Every one spelled "object type ×
    // operation" - the taxonomy this language has been deleting command by command - and every one is
    // now `/transform` or `/reset` saying the same thing with a prop rather than a token:
    //
    //   /fx hero            → /transform hero <prop=…>   (an effect was one prop of the one bag)
    //   /mirror hero        → /transform hero flip=on
    //   /move Alice at=left → /transform Alice pos=left
    //   /camera zoom 2      → /transform camera zoom=2   (`camera` is a reserved TARGET now)
    //   /blink d=0.2        → /transform camera lens=blink
    //   /vignette hold=0.6  → /transform camera lens=vignettePulse
    //   /screen blink       → /transform camera lens=blink
    //
    // Burned rather than reused, for the reason spelled out above: a token is what a stored line
    // RE-PARSES as, and script files and `invalid` rows keep the author's source text verbatim. The
    // sharpest case in this set is `/move`: handing that word to anything else would silently
    // reinterpret every `/move Alice at=left` sitting in an exported script, as whatever the new
    // command means, with no diagnostic anywhere. `/camera` is the same fact from the other side -
    // the word is now a target NAME, and a line beginning `/camera` must keep failing to resolve
    // rather than one day meaning "transform the thing called camera".
    //
    // None of them left rows behind that need a spelling: their payloads are `displayable` and
    // `camera`, and `storyVerbVocabulary.ts` names the live command that owns each one. So these
    // entries burn words and answer nothing, exactly as `/code` does.
    ["fx", ["fx", "effect"]],
    ["mirror", ["mirror"]],
    ["move", ["move"]],
    ["camera", ["camera", "cam"]],
    ["blink", ["blink"]],
    ["vignette", ["vignette", "vig"]],
    ["screen", ["screen", "screenfx"]],
]);

const RESERVED_TOKENS: ReadonlySet<string> = new Set([...RETIRED_COMMAND_TOKENS.values()].flat());

/**
 * The spelling a retired command's rows still read back as, or `null` for any live or unknown id.
 *
 * A row outlives the command that wrote it. A `saved` or `persistent` declaration in a project the
 * retirement pass could not migrate - a frozen one, where every write silently no-ops - still sits in
 * its scene, and `getDefById` answers `null` for it. Without this, the line such a row prints falls
 * back to the raw command id and the author is shown `/declareVar Honest type=boolean`: an internal
 * identifier, in the row, and in the file the script export writes.
 *
 * The canonical token is the answer rather than an alias because it is the spelling the row's own
 * `/save …` line was most likely typed as, and the only one of the three that is a word.
 */
export function retiredCommandToken(commandId: string): string | null {
    return RETIRED_COMMAND_TOKENS.get(commandId)?.[0] ?? null;
}

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
            if (RESERVED_TOKENS.has(token)) {
                throw new Error(`Reserved story command token or alias: "${token}" belonged to a retired command.`);
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
 * Derived, never authored - it tracks the catalog and every locale for free. Params and enum values
 * have their own twins of this table (`localizedParams.ts` off `story.paramHint.*`,
 * `localizedEnums.ts` off `story.enumValue.*`), built the same way and dropping on the same rules. A
 * localized token is additive, never a shadow: an entry is dropped when its folded label is blank,
 * contains whitespace (a multi-word label is not a single inline token), or already spells a
 * canonical English token, so the English pass in {@link getCommandDef} always wins and existing
 * behaviour is unchanged. A label two commands happen to share resolves to the first.
 *
 * **Both directions come out of this one pass.** `accept` is what the parser reads; `insert` is the
 * spelling a completion drops into the line ({@link localizedCommandToken}). Building them together
 * is the whole guarantee: a word can only be offered if it was also accepted, so what the menu shows
 * always round-trips. They were separate once - the menu showed 隐藏 and inserted `hide` - and one
 * pick then taught the author a word and typed a different one.
 *
 * Keyed on the COMMAND locale, not the interface locale (`editor.localizedCommands`; see
 * `lib/i18n/commandLocale`) - the vocabulary the author types is its own setting, so an English
 * command line behind a Chinese interface is a supported combination. Dropped whenever that store
 * notifies, which covers a language switch, "auto" following the interface, and a plugin language
 * pack swapping the catalog under a fixed locale.
 */
type LocalizedTokens = {
    locale: string;
    /** Folded localized spelling → def. The parser's pass. */
    accept: ReadonlyMap<string, StoryCommandDef>;
    /** Def → the spelling to write, as authored (case and all). Only defs that earned one. */
    insert: ReadonlyMap<StoryCommandDef, string>;
};

let localizedTokens: LocalizedTokens | null = null;
commandI18nStore.subscribe(() => {
    localizedTokens = null;
});

function localizedTokenTables(): LocalizedTokens {
    const locale = commandI18nStore.getLocale();
    if (localizedTokens?.locale === locale) {
        return localizedTokens;
    }
    const canonical = canonicalTokens();
    const accept = new Map<string, StoryCommandDef>();
    const insert = new Map<StoryCommandDef, string>();
    for (const def of DEFS) {
        const key = commandLabelKey(def.commandId);
        const raw = translateCommand(key).trim();
        const label = raw.toLowerCase();
        // `translate` echoes the key back on a missing entry - that is not a token. A blank or
        // multi-word label is not a single inline token either; a label already spelling a canonical
        // English token is handled by the English pass; a duplicate resolves to the first def.
        if (!label || raw === key || /\s/.test(label) || canonical.has(label) || accept.has(label)) {
            continue;
        }
        accept.set(label, def);
        insert.set(def, raw);
    }
    localizedTokens = { locale, accept, insert };
    return localizedTokens;
}

function localizedTokenMap(): ReadonlyMap<string, StoryCommandDef> {
    return localizedTokenTables().accept;
}

/**
 * How this command is spelled in the command language: the localized token when it has one that
 * parses, else the canonical English token.
 *
 * The one call every surface that WRITES a command word goes through - the completion menu, and the
 * line's own verb ({@link localizeCommandVerb}). Whatever comes back is a key of the accept table
 * above, so it always reads back as this very command; there is no locale in which a menu pick or a
 * re-spelling produces a line the parser cannot take.
 */
export function localizedCommandToken(def: StoryCommandDef): string {
    // The source locale writes the canonical token, always: the English label is where the token came
    // from, so anything else here would be the catalog second-guessing the grammar.
    if (commandI18nStore.getLocale() === SOURCE_LOCALE) {
        return def.token;
    }
    return localizedTokenTables().insert.get(def) ?? def.token;
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

/**
 * The command a typed word most nearly names, or `null` when nothing in the catalogue is close.
 *
 * Read only when a line has already failed to resolve, so that the message can say more than "there
 * is no such command". The word an author reaches for is not always a word that ever parsed here -
 * it can be one that USED to (`/face` became `/char`, and its Chinese label went from 表情 to 外观
 * with it), or the word for the same thing in a neighbouring part of the vocabulary. Both cases have
 * the same answer, and it is not a table of retired words: the catalogue already says, in the
 * author's own language, what every command is and what it does, so the word is looked for in what
 * is there NOW rather than in a record of what used to be. A second, historical vocabulary would be
 * a list nobody maintains and every rename would have to remember to grow.
 *
 * Three passes, most specific first, and each of them silent unless the answer is unique:
 *
 *  1. a spelling this word is the beginning of - the abbreviation an author stopped short on;
 *  2. a spelling one or two edits away - the typo;
 *  3. a command whose own label or description uses the word - which is what catches a renamed
 *     command, since the thing it does has not changed and its description still says so.
 *
 * Every locale is read, not just the active one: an author can have the interface in one language
 * and the old word from another in their fingers, and the answer costs nothing extra.
 */
export function suggestCommandDef(token: string): StoryCommandDef | null {
    const typed = token.trim().toLowerCase();
    // One character is not a guess, it is every command at once - and the parser has not decided the
    // author is finished with a token that short anyway.
    if (typed.length < 2) {
        return null;
    }
    const hints = commandHints();
    let prefix: { def: StoryCommandDef; length: number } | null = null;
    let nearest: { def: StoryCommandDef; distance: number } | null = null;
    // Two edits on a long word, one on a short one: at three characters, two edits reaches most of
    // the catalogue and the answer stops meaning anything.
    const limit = typed.length <= 4 ? 1 : 2;
    for (const [spelling, def] of hints.spellings) {
        if (spelling.startsWith(typed) && (!prefix || spelling.length < prefix.length)) {
            prefix = { def, length: spelling.length };
        }
        const distance = editDistance(typed, spelling, limit);
        if (distance !== null && (!nearest || distance < nearest.distance)) {
            nearest = { def, distance };
        }
    }
    if (prefix) {
        return prefix.def;
    }
    // Before the near spellings, not after: a word that appears WHOLE in exactly one command's own
    // description is stronger evidence than a word one character away from something. It has to be,
    // across locales - Japanese spells `/show` 表示, which is one character from the Chinese 表情, and
    // an author reaching for the appearance command would have been sent to the wrong one.
    const described = DEFS.filter(def => hints.described.get(def.commandId)?.some(text => mentions(text, typed)));
    if (described.length === 1) {
        return described[0];
    }
    return nearest?.def ?? null;
}

/**
 * Whether a description uses this word - as a word, where the script has words.
 *
 * A boundary check for a token written in letters and digits, so `set` does not match inside
 * `preset`; plain containment for a script that does not space its words, where there is no boundary
 * to find and the token is a whole word by construction.
 */
function mentions(text: string, typed: string): boolean {
    if (!/^[a-z0-9]+$/.test(typed)) {
        return text.includes(typed);
    }
    const at = text.indexOf(typed);
    if (at < 0) {
        return false;
    }
    const before = text[at - 1];
    const after = text[at + typed.length];
    return !/[a-z0-9]/.test(before ?? "") && !/[a-z0-9]/.test(after ?? "");
}

/**
 * Levenshtein distance, or `null` once it is certain to exceed `limit`.
 *
 * Bounded rather than complete because the answer is only ever compared against a threshold, and the
 * length check alone drops most of the catalogue before a single row is filled.
 */
function editDistance(a: string, b: string, limit: number): number | null {
    if (Math.abs(a.length - b.length) > limit) {
        return null;
    }
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let best = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
            row.push(value);
            best = Math.min(best, value);
        }
        if (best > limit) {
            return null;
        }
        previous = row;
    }
    const distance = previous[b.length];
    return distance <= limit ? distance : null;
}

type CommandHints = {
    /** The locale registry's version this was built against - a language pack invalidates it. */
    version: number;
    /** Folded spelling → def: every canonical token, spec id, alias, and every locale's label. */
    spellings: Map<string, StoryCommandDef>;
    /** Command id → its own label and description in every locale, folded, for the third pass. */
    described: Map<string, string[]>;
};

let hints: CommandHints | null = null;
commandI18nStore.subscribe(() => {
    hints = null;
});

function commandHints(): CommandHints {
    const version = getLocaleRegistryVersion();
    if (hints?.version === version) {
        return hints;
    }
    const spellings = new Map<string, StoryCommandDef>();
    const described = new Map<string, string[]>();
    const claim = (spelling: string, def: StoryCommandDef): void => {
        const folded = spelling.trim().toLowerCase();
        // A spelling two commands share answers to the first, the same rule the localized token table
        // applies - and a suggestion has to name one command or it is not a suggestion.
        if (folded && !/\s/.test(folded) && !spellings.has(folded)) {
            spellings.set(folded, def);
        }
    };
    const locales = [...SUPPORTED_LOCALES, ...listOverlayLocales()];
    const translators = locales.map(locale => createTranslator(locale));
    for (const def of DEFS) {
        claim(def.token, def);
        claim(def.commandId, def);
        for (const alias of def.aliases ?? []) {
            claim(alias, def);
        }
        const texts: string[] = [];
        for (const translator of translators) {
            for (const key of [commandLabelKey(def.commandId), commandDetailKey(def.commandId)]) {
                const value = translator.t(key).trim();
                // `t` echoes the key back when nothing answers it, which is not a word of anything.
                if (!value || value === key) {
                    continue;
                }
                if (key === commandLabelKey(def.commandId)) {
                    claim(value, def);
                }
                texts.push(value.toLowerCase());
            }
        }
        described.set(def.commandId, texts);
    }
    hints = { version, spellings, described };
    return hints;
}
