import type { StoryCommandDef } from "./storyCommandGrammar";
import { commandOwningSpelling, getCommandDef, getDefById } from "./commands/registry";

/**
 * The author's own abbreviations for story commands: `/c` for `/外观`, set by the author, for the
 * author.
 *
 * An abbreviation is an input method, not a word of the command language. The parser never sees one:
 * the line being typed replaces it with the command's real spelling the moment the word is finished
 * (`expandCommandAbbreviation`), and the commit path does the same for a line that is committed
 * without the word ever being finished. So no row, no `invalid` row's source and no exported script
 * ever holds one - which is the whole reason this is safe to make personal. The parser's tables serve
 * text written years ago (`invalid` rows and script files re-parse verbatim; see the registry's
 * retired-token notes), and a per-author word in those tables would make one file read differently
 * on two machines, and change what an old line means every time the author edits the list.
 *
 * Stored per user in global state, abbreviation → spec id, so a word can only ever name one command,
 * and a rename of the command's label or a switch of the command language leaves every entry
 * pointing where it did. Built-in spellings always win: a word that becomes a real command's spelling
 * in a later version stops expanding, and the command's page says so.
 */

export const ABBREVIATIONS_SETTING_KEY = "story.commandAbbreviations";

/** Folded abbreviation → spec id. */
export type StoryCommandAbbreviations = ReadonlyMap<string, string>;

export const NO_ABBREVIATIONS: StoryCommandAbbreviations = new Map();

/** How an abbreviation is compared and stored: trimmed and lower-cased, as the parser folds tokens. */
export function foldAbbreviation(word: string): string {
    return word.trim().toLowerCase();
}

/**
 * The stored value, read defensively: anything that is not a string → string record is dropped
 * entry by entry rather than as a whole, so one bad entry written by some other build costs one
 * abbreviation and not the list.
 */
export function resolveStoredAbbreviations(stored: unknown): StoryCommandAbbreviations {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
        return NO_ABBREVIATIONS;
    }
    const map = new Map<string, string>();
    for (const [word, commandId] of Object.entries(stored as Record<string, unknown>)) {
        const folded = foldAbbreviation(word);
        if (folded && typeof commandId === "string" && commandId && !map.has(folded)) {
            map.set(folded, commandId);
        }
    }
    return map;
}

export function serializeAbbreviations(abbreviations: StoryCommandAbbreviations): Record<string, string> {
    return Object.fromEntries(abbreviations);
}

export function sameAbbreviations(a: StoryCommandAbbreviations, b: StoryCommandAbbreviations): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [word, commandId] of a) {
        if (b.get(word) !== commandId) {
            return false;
        }
    }
    return true;
}

/**
 * Characters an abbreviation may not contain. A space ends a token; quotes are the tokenizer's own;
 * `=` splits a named argument; `/`, `@` and `#` are line triggers, and a word holding one would read
 * as a different kind of line the moment it was typed.
 */
const FORBIDDEN_CHARACTERS = /["'=/@#]/;

export type AbbreviationCheck =
    | { ok: true; word: string }
    | { ok: false; reason: "empty" | "space" | "character" }
    /** A word some command already answers to, in some language. */
    | { ok: false; reason: "builtIn"; def: StoryCommandDef }
    /** A word already abbreviating a different command. */
    | { ok: false; reason: "taken"; def: StoryCommandDef };

/** Whether `word` can become an abbreviation for `commandId`, and why not when it cannot. */
export function checkAbbreviation(word: string, commandId: string, abbreviations: StoryCommandAbbreviations): AbbreviationCheck {
    const folded = foldAbbreviation(word);
    if (!folded) {
        return { ok: false, reason: "empty" };
    }
    if (/\s/.test(folded)) {
        return { ok: false, reason: "space" };
    }
    if (FORBIDDEN_CHARACTERS.test(folded)) {
        return { ok: false, reason: "character" };
    }
    const owner = commandOwningSpelling(folded);
    if (owner) {
        return { ok: false, reason: "builtIn", def: owner };
    }
    const existing = abbreviations.get(folded);
    const existingDef = existing && existing !== commandId ? getDefById(existing) : null;
    if (existingDef) {
        return { ok: false, reason: "taken", def: existingDef };
    }
    return { ok: true, word: folded };
}

/**
 * The command a typed word abbreviates, or `null`.
 *
 * `null` for any word the parser already resolves - a built-in spelling is never shadowed - and for
 * an entry whose command no longer exists.
 */
export function abbreviatedCommand(word: string, abbreviations: StoryCommandAbbreviations): StoryCommandDef | null {
    const folded = foldAbbreviation(word);
    const commandId = folded ? abbreviations.get(folded) : undefined;
    if (!commandId || getCommandDef(folded)) {
        return null;
    }
    return getDefById(commandId);
}

/** One command's abbreviations, in the order they read best: shortest first, then alphabetical. */
export function abbreviationsOf(commandId: string, abbreviations: StoryCommandAbbreviations): string[] {
    const words: string[] = [];
    for (const [word, id] of abbreviations) {
        if (id === commandId) {
            words.push(word);
        }
    }
    return words.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/**
 * The abbreviations that still expand, folded abbreviation → spec id: the stored list minus every
 * word a built-in now spells and every entry whose command is gone. What the `/` menu ranks and
 * prints, so it never advertises a word that would not do what it says.
 */
export function liveAbbreviations(abbreviations: StoryCommandAbbreviations): StoryCommandAbbreviations {
    const live = new Map<string, string>();
    for (const [word, commandId] of abbreviations) {
        if (abbreviatedCommand(word, abbreviations)?.commandId === commandId) {
            live.set(word, commandId);
        }
    }
    return live;
}
