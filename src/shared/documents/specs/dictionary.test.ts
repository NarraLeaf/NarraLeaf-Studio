import {beforeEach, describe, expect, it} from "vitest";
import {DocumentStorage, loadDocument, saveDocument} from "@shared/documents/documentIo";
import {resolveDocumentSpecForPath} from "@shared/documents/registry";
import {DICTIONARY_DOCUMENT_PATH, dictionarySpec} from "@shared/documents/specs";
import {
    createEmptyProjectDictionaryDocument,
    DEFAULT_DICTIONARY_OPTIONS,
    dictionaryAcceptedWords,
    normalizeDictionaryEntries,
    PROJECT_DICTIONARY_SCHEMA_VERSION,
    type ProjectDictionaryDocument,
    type ProjectDictionaryEntry,
} from "@shared/types/dictionary";

/**
 * The project dictionary as a document: it round-trips, it reads an older file the same way twice,
 * and it refuses the shapes whose only other outcome is silently emptying itself.
 *
 * The last of those is the one worth having. The normalizer answers an empty list for anything it
 * cannot read, this document is written back on the first term added, and the two together turn a
 * file this build does not understand into a file with nothing in it - which is the whole of the
 * project's vocabulary, gone with no error anywhere.
 */

class MemoryStorage implements DocumentStorage {
    public readonly files = new Map<string, string>();

    public read(path: string): Promise<string | null> {
        return Promise.resolve(this.files.get(path) ?? null);
    }

    public write(path: string, text: string): Promise<void> {
        this.files.set(path, text);
        return Promise.resolve();
    }

    public copy(fromPath: string, toPath: string): Promise<void> {
        const value = this.files.get(fromPath);
        if (value === undefined) {
            return Promise.reject(new Error(`no such file: ${fromPath}`));
        }
        this.files.set(toPath, value);
        return Promise.resolve();
    }
}

let storage: MemoryStorage;

beforeEach(() => {
    storage = new MemoryStorage();
});

const document = (entries: ProjectDictionaryEntry[]): ProjectDictionaryDocument => ({
    schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
    entries: normalizeDictionaryEntries(entries),
    options: {...DEFAULT_DICTIONARY_OPTIONS},
});

describe("the project dictionary document", () => {
    it("is the spec that owns editor/dictionary.json", () => {
        expect(dictionarySpec.pathFor()).toBe(DICTIONARY_DOCUMENT_PATH);
        expect(resolveDocumentSpecForPath(DICTIONARY_DOCUMENT_PATH)?.spec.kind).toBe("dictionary");
        // Windows separators reach this from the version-control side, which reports native paths.
        expect(dictionarySpec.matches("editor\\dictionary.json")).toBe(true);
    });

    it("round-trips a term with its reading, its variants and its note", async () => {
        const saved = document([
            {term: "Kamurocho", reading: "かむろちょう", variants: ["Kamurocyo"], note: "The district"},
            {term: "Anyo"},
        ]);

        await saveDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH, saved);
        const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect(result.document).toStrictEqual(saved);
        // Already canonical on the way out, so opening a project cannot schedule a save that changes
        // only the bytes - which is a version-control change nobody made.
        expect(result.normalized).toBe(true);
    });

    it("round-trips an empty dictionary", async () => {
        const empty = createEmptyProjectDictionaryDocument();

        await saveDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH, empty);
        const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect(result.document).toStrictEqual(empty);
    });

    it("reads a v1 file as the same terms with nothing else set", async () => {
        storage.files.set(
            DICTIONARY_DOCUMENT_PATH,
            JSON.stringify({schemaVersion: 1, words: ["Kamurocho", "Anyo"]}),
        );

        const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect(result.document.entries).toEqual([{term: "Anyo"}, {term: "Kamurocho"}]);
        expect(result.document.options).toStrictEqual(DEFAULT_DICTIONARY_OPTIONS);
        // Read as the current schema, so the first edit writes v2 rather than half of each.
        expect(result.document.schemaVersion).toBe(PROJECT_DICTIONARY_SCHEMA_VERSION);
    });

    it("sorts and de-duplicates, so two machines writing the same terms write the same file", () => {
        expect(document([{term: "Zeta"}, {term: "alpha"}, {term: "Zeta"}, {term: "  alpha  "}]).entries)
            .toEqual([{term: "Zeta"}, {term: "alpha"}]);
        // Code-unit order, not locale order: the file is compared and merged, and an order that
        // depended on the machine that saved would reorder the whole list for every teammate.
        expect(document([{term: "b"}, {term: "A"}, {term: "a"}, {term: "B"}]).entries.map(entry => entry.term))
            .toEqual(["A", "B", "a", "b"]);
    });

    it("merges two records of one term rather than dropping either", () => {
        const merged = document([
            {term: "Anyo", reading: "アンヨ"},
            {term: "Anyo", variants: ["Anyou"], note: "kept"},
        ]);

        expect(merged.entries).toEqual([{term: "Anyo", reading: "アンヨ", variants: ["Anyou"], note: "kept"}]);
    });

    it("keeps a term made of two words and drops what cannot be a term at all", () => {
        // A place name is a term the project has. The spellchecker never matches it, which costs
        // nothing, and dropping it would lose something the author typed.
        expect(document([{term: "New  Kamurocho"}]).entries).toEqual([{term: "New Kamurocho"}]);
        expect(normalizeDictionaryEntries(["   ", "", 7, null, {}, {term: "kept"}])).toEqual([{term: "kept"}]);
    });

    it("drops a variant that is the term itself, however it is capitalised", () => {
        expect(document([{term: "Colour", variants: ["colour", "color"]}]).entries)
            .toEqual([{term: "Colour", variants: ["color"]}]);
    });

    it("hands the spellchecker the terms and their variants", () => {
        const entries = document([
            {term: "Colour", variants: ["color"]},
            {term: "Anyo", reading: "アンヨ"},
        ]).entries;

        // The variants are in the list on purpose: a variant is a real word written the wrong way
        // for this project, and the dictionary marks it itself. Left out, a project checked by
        // segmentation would have it marked twice.
        expect(dictionaryAcceptedWords(entries)).toEqual(["Anyo", "Colour", "color"]);
    });

    it("reads a file with no terms as a dictionary with no terms", async () => {
        storage.files.set(DICTIONARY_DOCUMENT_PATH, JSON.stringify({schemaVersion: 2}));

        const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect(result.document.entries).toEqual([]);
    });

    it("refuses a list that is not a list, rather than reading it as no terms", async () => {
        storage.files.set(DICTIONARY_DOCUMENT_PATH, JSON.stringify({schemaVersion: 2, entries: {a: 1}}));
        expect((await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH)).status).toBe("corrupt");

        storage.files.set(DICTIONARY_DOCUMENT_PATH, JSON.stringify({schemaVersion: 1, words: {a: 1}}));
        expect((await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH)).status).toBe("corrupt");
    });

    it("refuses a document a newer Studio wrote", async () => {
        storage.files.set(
            DICTIONARY_DOCUMENT_PATH,
            JSON.stringify({schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION + 1, entries: [{term: "Anyo"}]}),
        );

        const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

        expect(result.status).toBe("corrupt");
    });

    it("counts the terms for the history row", () => {
        expect(dictionarySpec.summarize(document([{term: "Anyo"}, {term: "Kamurocho"}]))).toStrictEqual({
            title: "",
            counts: [{key: "dictionaryTerms", value: 2}],
        });
    });
});
