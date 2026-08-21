/**
 * The project dictionary - the terms this project writes on purpose, and how it writes them.
 *
 * Character names, place names, invented vocabulary: things no general word list knows and every
 * author of this project needs recognised. Chromium keeps its own custom dictionary in the Electron
 * profile, which is machine-scoped - a teammate cloning the repository would meet the same red
 * underlines the author already dismissed, and so would the author on a second computer. So the list
 * lives here, in the project, and is pushed into the session while the project is open.
 *
 * An entry carries three things beyond the spelling itself, and each one is read by a different
 * surface of the story editor:
 *
 *  - **the term** is what the spellchecker is told never to mark;
 *  - **the reading** is the ruby the term is annotated with, offered wherever the term is written
 *    without one;
 *  - **the variants** are spellings that mean the term but are not how this project writes it, and
 *    are marked where they appear.
 *
 * That is the whole of the model. Everything a richer record could carry - who added it, when, which
 * scene it came from - is bookkeeping about the list rather than part of it.
 *
 * Comments in English per project convention.
 */

/**
 * Persisted document version for `editor/dictionary.json`. Independent of every other document.
 *
 * v2 replaced the flat `words: string[]` of v1 with {@link ProjectDictionaryEntry}. A v1 file reads
 * as terms with nothing else set, which is exactly what it held.
 */
export const PROJECT_DICTIONARY_SCHEMA_VERSION = 2;

/**
 * One term the project spells on purpose.
 *
 * `term` is the identity: there is at most one entry per spelling, and every other field describes
 * that spelling. The three optional fields are absent rather than empty when unset, so a dictionary
 * of bare terms writes the same bytes it did under v1 plus a field name.
 */
export type ProjectDictionaryEntry = {
    /** The spelling this project uses. Never blank. */
    term: string;
    /**
     * The reading typed over the term - furigana over kanji, pinyin over hanzi.
     *
     * Offered on an occurrence of the term that carries no ruby of its own; never applied without
     * being asked for, because whether a reading is repeated on every occurrence or written once at
     * the first is a house style this document has no opinion on.
     */
    reading?: string;
    /**
     * Spellings that mean this term but are not how the project writes it.
     *
     * Marked where they appear in a story, with the term offered as the replacement. Matched without
     * regard to case, so a variant listed once covers the same word at the start of a sentence.
     */
    variants?: string[];
    /** What the term is, for whoever reads the list later. Shown in the dictionary panel only. */
    note?: string;
};

/**
 * What the project asks the dictionary to do while a story is open.
 *
 * Both default on. They are per project rather than per author because they describe the script -
 * a project that writes its readings once at the first occurrence wants the reading hints off for
 * everyone, not for whoever last opened Settings.
 */
export type ProjectDictionaryOptions = {
    /** Offer the reading on an occurrence of a term that carries none. */
    suggestReadings: boolean;
    /** Mark a variant spelling where it appears. */
    checkVariants: boolean;
};

/** The persisted document. */
export type ProjectDictionaryDocument = {
    schemaVersion: number;
    entries: ProjectDictionaryEntry[];
    options: ProjectDictionaryOptions;
};

/**
 * What an entry may be created or edited with. The term is the identity and is passed separately.
 *
 * `null` on an optional field removes it, `undefined` leaves it as it was - the distinction a patch
 * has to make and a partial record cannot.
 */
export type DictionaryEntryPatch = {
    /** Rename the term. Refused when another entry already holds the new spelling. */
    term?: string;
    reading?: string | null;
    variants?: string[];
    note?: string | null;
};

export const DEFAULT_DICTIONARY_OPTIONS: ProjectDictionaryOptions = {
    suggestReadings: true,
    checkVariants: true,
};

/**
 * One written form, from whatever was on disk. `null` when there is nothing usable to keep.
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

/** Code-unit order, so the file a diff and a three-way merge see does not depend on the machine that saved it. */
function byCodeUnit(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The variants of one entry as the rest of Studio may assume them: usable, unique, sorted, and none
 * of them the term itself.
 *
 * A variant equal to the term is dropped because it can only ever mark a correctly written word.
 * Case is kept - a variant list is written by hand and the author's capitalisation is the one worth
 * showing back - but the comparison against the term ignores it, because the matcher does too.
 */
export function normalizeDictionaryVariants(raw: unknown, term: string): string[] {
    const source = Array.isArray(raw) ? raw : [];
    const folded = term.toLowerCase();
    const seen = new Map<string, string>();
    for (const entry of source) {
        const variant = normalizeDictionaryWord(entry);
        if (!variant) {
            continue;
        }
        const key = variant.toLowerCase();
        if (key === folded || seen.has(key)) {
            continue;
        }
        seen.set(key, variant);
    }
    return [...seen.values()].sort(byCodeUnit);
}

/** One entry, from whatever was on disk. `null` when it has no term and so describes nothing. */
export function normalizeDictionaryEntry(raw: unknown): ProjectDictionaryEntry | null {
    if (typeof raw === "string") {
        // A v1 file, one word at a time.
        const term = normalizeDictionaryWord(raw);
        return term ? {term} : null;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const term = normalizeDictionaryWord(record.term);
    if (!term) {
        return null;
    }
    const entry: ProjectDictionaryEntry = {term};
    const reading = normalizeDictionaryWord(record.reading);
    if (reading) {
        entry.reading = reading;
    }
    const variants = normalizeDictionaryVariants(record.variants, term);
    if (variants.length > 0) {
        entry.variants = variants;
    }
    // Trimmed but not collapsed: a note is prose, and the line breaks in it are the author's.
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) {
        entry.note = note;
    }
    return entry;
}

/**
 * The list as the rest of Studio may assume it: usable entries only, one per term, sorted by term.
 *
 * Sorted at all because a term added by hand belongs where the reader would look for it, and because
 * an insertion into a sorted list is one line in a diff wherever it lands. Two entries for one term
 * are merged rather than one dropped: they can only arise from a hand-edited file or a merge that
 * kept both sides, and in either case both halves were written on purpose.
 */
export function normalizeDictionaryEntries(raw: unknown): ProjectDictionaryEntry[] {
    const source = Array.isArray(raw) ? raw : [];
    const byTerm = new Map<string, ProjectDictionaryEntry>();
    for (const item of source) {
        const entry = normalizeDictionaryEntry(item);
        if (!entry) {
            continue;
        }
        const existing = byTerm.get(entry.term);
        byTerm.set(entry.term, existing ? mergeEntries(existing, entry) : entry);
    }
    return [...byTerm.values()].sort((left, right) => byCodeUnit(left.term, right.term));
}

/** Two records of one term, as one. The earlier reading and note win; the variants are unioned. */
function mergeEntries(earlier: ProjectDictionaryEntry, later: ProjectDictionaryEntry): ProjectDictionaryEntry {
    const merged: ProjectDictionaryEntry = {term: earlier.term};
    const reading = earlier.reading ?? later.reading;
    if (reading) {
        merged.reading = reading;
    }
    const variants = normalizeDictionaryVariants(
        [...(earlier.variants ?? []), ...(later.variants ?? [])],
        earlier.term,
    );
    if (variants.length > 0) {
        merged.variants = variants;
    }
    const note = earlier.note ?? later.note;
    if (note) {
        merged.note = note;
    }
    return merged;
}

/** The options as stored, with anything unreadable falling back to the default rather than to off. */
export function normalizeDictionaryOptions(raw: unknown): ProjectDictionaryOptions {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    return {
        suggestReadings: typeof record.suggestReadings === "boolean"
            ? record.suggestReadings
            : DEFAULT_DICTIONARY_OPTIONS.suggestReadings,
        checkVariants: typeof record.checkVariants === "boolean"
            ? record.checkVariants
            : DEFAULT_DICTIONARY_OPTIONS.checkVariants,
    };
}

/** Every term, sorted. What the spellchecker is told to accept, and what a v1 file held. */
export function dictionaryTerms(entries: readonly ProjectDictionaryEntry[]): string[] {
    return entries.map(entry => entry.term);
}

/**
 * Every spelling the spellchecker must not mark: the terms, and the variants of them.
 *
 * The variants are in here on purpose. A variant is a real word written the wrong way for this
 * project, and a project written in a language checked by segmentation would otherwise have it
 * marked twice - once as an unknown run, once as a variant - which reads as two different problems
 * with the same word.
 */
export function dictionaryAcceptedWords(entries: readonly ProjectDictionaryEntry[]): string[] {
    const words = new Set<string>();
    for (const entry of entries) {
        words.add(entry.term);
        for (const variant of entry.variants ?? []) {
            words.add(variant);
        }
    }
    return [...words].sort(byCodeUnit);
}

/**
 * Whatever was on disk, as a document of the current schema.
 *
 * A v1 file is a list of words under `words`, and reads as the same terms with nothing else set.
 * Both fields are looked at rather than only the one this build writes, so a file written by a
 * mixture of builds - which a merge can produce - keeps everything either of them recorded.
 */
export function migrateProjectDictionaryDocument(raw: unknown): ProjectDictionaryDocument {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};

    const source = [
        ...(Array.isArray(record.entries) ? record.entries : []),
        ...(Array.isArray(record.words) ? record.words : []),
    ];

    return {
        schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
        entries: normalizeDictionaryEntries(source),
        options: normalizeDictionaryOptions(record.options),
    };
}

/** An absent document is a project nobody has taught a term yet: no entries at all. */
export function createEmptyProjectDictionaryDocument(): ProjectDictionaryDocument {
    return {
        schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
        entries: [],
        options: {...DEFAULT_DICTIONARY_OPTIONS},
    };
}
