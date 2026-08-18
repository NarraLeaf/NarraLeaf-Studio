import { beforeEach, describe, expect, it } from "vitest";
import { DocumentStorage, loadDocument, saveDocument } from "@shared/documents/documentIo";
import { resolveDocumentSpecForPath } from "@shared/documents/registry";
import { DICTIONARY_DOCUMENT_PATH, dictionarySpec } from "@shared/documents/specs";
import {
  createEmptyProjectDictionaryDocument,
  normalizeDictionaryWords,
  PROJECT_DICTIONARY_SCHEMA_VERSION,
  type ProjectDictionaryDocument
} from "@shared/types/dictionary";

/**
 * The project dictionary as a document: it round-trips, it reads an older file the same way twice,
 * and it refuses the shapes whose only other outcome is silently emptying itself.
 *
 * The last of those is the one worth having. The normalizer answers an empty list for anything it
 * cannot read, this document is written back on the first word added, and the two together turn a
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

const document = (words: string[]): ProjectDictionaryDocument => ({
  schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION,
  words: normalizeDictionaryWords(words)
});

describe("the project dictionary document", () => {
  it("is the spec that owns editor/dictionary.json", () => {
    expect(dictionarySpec.pathFor()).toBe(DICTIONARY_DOCUMENT_PATH);
    expect(resolveDocumentSpecForPath(DICTIONARY_DOCUMENT_PATH)?.spec.kind).toBe("dictionary");
    // Windows separators reach this from the version-control side, which reports native paths.
    expect(dictionarySpec.matches("editor\\dictionary.json")).toBe(true);
  });

  it("round-trips the words an author added", async () => {
    const saved = document(["Anyo", "Kamurocho", "nanomachine"]);

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

  it("sorts and de-duplicates, so two machines writing the same words write the same file", () => {
    expect(document(["Zeta", "alpha", "Zeta", "  alpha  "]).words).toEqual(["Zeta", "alpha"]);
    // Code-unit order, not locale order: the file is compared and merged, and an order that
    // depended on the machine that saved would reorder the whole list for every teammate.
    expect(document(["b", "A", "a", "B"]).words).toEqual(["A", "B", "a", "b"]);
  });

  it("keeps a term made of two words and drops what cannot be a term at all", () => {
    // A place name is a term the project has. The spellchecker never matches it, which costs
    // nothing, and dropping it would lose something the author typed.
    expect(document(["New  Kamurocho"]).words).toEqual(["New Kamurocho"]);
    expect(normalizeDictionaryWords(["   ", "", 7, null, {}, "kept"])).toEqual(["kept"]);
  });

  it("reads a file with no words as a dictionary with no words", async () => {
    storage.files.set(DICTIONARY_DOCUMENT_PATH, JSON.stringify({ schemaVersion: 1 }));

    const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(result.document.words).toEqual([]);
  });

  it("refuses a words field that is not a list, rather than reading it as no words", async () => {
    storage.files.set(
      DICTIONARY_DOCUMENT_PATH,
      JSON.stringify({ schemaVersion: 1, words: { a: 1 } })
    );

    const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

    expect(result.status).toBe("corrupt");
  });

  it("refuses a document a newer Studio wrote", async () => {
    storage.files.set(
      DICTIONARY_DOCUMENT_PATH,
      JSON.stringify({ schemaVersion: PROJECT_DICTIONARY_SCHEMA_VERSION + 1, words: ["Anyo"] })
    );

    const result = await loadDocument(dictionarySpec, storage, DICTIONARY_DOCUMENT_PATH);

    expect(result.status).toBe("corrupt");
  });

  it("counts the words for the history row", () => {
    expect(dictionarySpec.summarize(document(["Anyo", "Kamurocho"]))).toStrictEqual({
      title: "",
      counts: [{ key: "dictionaryWords", value: 2 }]
    });
  });
});
