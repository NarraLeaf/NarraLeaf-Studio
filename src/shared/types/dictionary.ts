/**
 * The project dictionary - the words this project spells on purpose.
 *
 * Character names, place names, invented terms: things no general dictionary knows and every
 * author of this project needs recognised. Chromium keeps its own custom dictionary in the Electron
 * profile, which is machine-scoped - a teammate cloning the repository would meet the same red
 * underlines the author already dismissed, and so would the author on a second computer. So the
 * list lives here, in the project, and is pushed into the session while the project is open.
 *
 * It is a term list before it is a spellchecker input. Spellchecking is the first thing that reads
 * it, but Chromium ships no hunspell dictionary for Chinese or Japanese, so for a project written
 * in either the list is checked against nothing and is still worth keeping: it is the project's
 * vocabulary, and what a later consistency check would have to be written against.
 *
 * Comments in English per project convention.
 */

/** Persisted document version for `editor/dictionary.json`. Independent of every other document. */
export const PROJECT_DICTIONARY_SCHEMA_VERSION = 1;

/**
 * The persisted document.
 *
 * A flat array of strings, and deliberately nothing more. Every field a richer record could carry -
 * who added it, when, which scene it came from - is bookkeeping about the list rather than part of
 * it, and none of it can be answered by the one gesture that writes here (a right click on a word).
 */
export type ProjectDictionaryDocument = {
    schemaVersion: number;
    words: string[];
};

/**
 * One entry, from whatever was on disk. `null` when there is nothing usable to keep.
 *
 * Internal runs of whitespace are collapsed rather than rejected: a two-word place name is a term
 * the project has, and the spellchecker simply never matches it, which costs nothing. What is
 * dropped is only what cannot be a term at all - a non-string, or a string that is blank once
 * trimmed.
 */
export function normalizeDictionaryWord(raw: unknown): string | null {
    if (typeof raw !== "string") {
        return null;
    }
    const word = raw.trim().replace(/\s+/g, " ");
    return word ? word : null;
}

/**
 * The list as the rest of Studio may assume it: usable entries only, no duplicates, sorted.
 *
 * Sorted by code unit rather than by {@link String.prototype.localeCompare}, which answers
 * differently per locale: the order is what a diff and a three-way merge see, and an order that
 * depends on the machine that last saved would show every teammate a reordered file. Sorted at all
 * because a word added by hand belongs where the reader would look for it, and because an insertion
 * into a sorted list is one line in a diff wherever it lands.
 */
export function normalizeDictionaryWords(raw: unknown): string[] {
    const source = Array.isArray(raw) ? raw : [];
    const words = new Set<string>();
    for (const entry of source) {
        const word = normalizeDictionaryWord(entry);
        if (word) {
            words.add(word);
        }
    }
    return [...words].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Whatever was on disk, as a document of the current schema.
 *
 * There is nothing to migrate yet - v1 is the first version - but the function exists from the
 * start so the spec has one entry point and a v2 has one place to be written.
 */
export function migrateProjectDictionaryDocument(raw: unknown): ProjectDictionaryDocument {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};

    return {
        schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
        words: normalizeDictionaryWords(record.words),
    };
}

/** An absent document is a project nobody has taught a word yet: no words at all. */
export function createEmptyProjectDictionaryDocument(): ProjectDictionaryDocument {
    return {
        schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
        words: [],
    };
}
