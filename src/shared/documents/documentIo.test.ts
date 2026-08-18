import { beforeEach, describe, expect, it } from "vitest";
import {
  DocumentStorage,
  loadDocument,
  quarantinePathFor,
  saveDocument
} from "@shared/documents/documentIo";
import { defineDocumentSpec } from "@shared/documents/registry";
import { DocumentCorruptError, DocumentSpec } from "@shared/documents/types";
import { DocumentPathError } from "@shared/documents/documentPath";

const DOCUMENT_PATH = "editor/voice/en-US.json";
const AT = new Date("2026-07-27T14:32:11.123Z");
const STAMP = "2026-07-27T14-32-11-123Z";

interface Library {
  schemaVersion: number;
  locale: string;
  units: Record<string, string>;
}

class MemoryStorage implements DocumentStorage {
  public readonly files = new Map<string, string>();
  public readonly writes: string[] = [];
  public failCopy = false;

  public read(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }

  public write(path: string, text: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, text);
    return Promise.resolve();
  }

  public copy(fromPath: string, toPath: string): Promise<void> {
    if (this.failCopy) {
      return Promise.reject(new Error("disk full"));
    }
    const value = this.files.get(fromPath);
    if (value === undefined) {
      return Promise.reject(new Error(`no such file: ${fromPath}`));
    }
    this.files.set(toPath, value);
    return Promise.resolve();
  }
}

const librarySpec: DocumentSpec<Library> = defineDocumentSpec<Library>({
  kind: "voice",
  version: 2,
  paths: ["editor/voice/<locale>.json"],
  parse: (raw, context) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return context.corrupt("expected an object at the document root");
    }
    const value = raw as Partial<Library>;
    if (typeof value.locale !== "string") {
      return context.corrupt("locale is missing");
    }
    // A v1 document had no units; migrating it up is what makes parse total.
    return {
      schemaVersion: 2,
      locale: value.locale,
      units: value.units ?? {}
    };
  },
  summarize: (document) => ({
    title: document.locale,
    counts: [{ key: "units", value: Object.keys(document.units).length }]
  })
});

const canonicalLibrary = librarySpec.serialize({
  schemaVersion: 2,
  locale: "en-US",
  units: { b: "two", a: "one" }
});

describe("loadDocument", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("parses a document and reports canonical bytes as normalized", async () => {
    storage.files.set(DOCUMENT_PATH, canonicalLibrary);

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH);

    expect(result).toEqual({
      status: "loaded",
      document: { schemaVersion: 2, locale: "en-US", units: { a: "one", b: "two" } },
      normalized: true
    });
  });

  it("reports bytes that are valid but not canonical as not normalized", async () => {
    storage.files.set(
      DOCUMENT_PATH,
      JSON.stringify({ schemaVersion: 2, locale: "en-US", units: {} })
    );

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH);

    expect(result.status).toBe("loaded");
    expect(result.status === "loaded" && result.normalized).toBe(false);
  });

  it("reports a document whose schema was migrated as not normalized", async () => {
    // Canonical bytes, older shape: the normalize pass still has to rewrite this one.
    storage.files.set(DOCUMENT_PATH, '{\n  "locale": "en-US",\n  "schemaVersion": 1\n}\n');

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH);

    expect(result.status === "loaded" && result.document.schemaVersion).toBe(2);
    expect(result.status === "loaded" && result.normalized).toBe(false);
  });

  it("reports a missing file as missing rather than as corruption", async () => {
    expect(await loadDocument(librarySpec, storage, DOCUMENT_PATH)).toEqual({ status: "missing" });
  });

  it("accepts a Windows path and normalises it", async () => {
    storage.files.set(DOCUMENT_PATH, canonicalLibrary);

    expect((await loadDocument(librarySpec, storage, "editor\\voice\\en-US.json")).status).toBe(
      "loaded"
    );
  });

  it("rejects a path that is not project-relative", async () => {
    await expect(
      loadDocument(librarySpec, storage, "D:/game/editor/voice/en-US.json")
    ).rejects.toThrow(DocumentPathError);
  });

  it("lets an I/O failure through instead of calling it corruption", async () => {
    const failing: DocumentStorage = {
      read: () => Promise.reject(new Error("EACCES")),
      write: () => Promise.resolve(),
      copy: () => Promise.resolve()
    };

    await expect(loadDocument(librarySpec, failing, DOCUMENT_PATH)).rejects.toThrow("EACCES");
  });
});

describe("loadDocument: corruption containment", () => {
  let storage: MemoryStorage;
  const quarantinePath = `.nlstudio/quarantine/${STAMP}/${DOCUMENT_PATH}`;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("quarantines the original bytes of an unparseable file and leaves the file alone", async () => {
    const truncated = '{"locale": "en-US", "units": {"a":';
    storage.files.set(DOCUMENT_PATH, truncated);

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH, { now: () => AT });

    expect(result.status).toBe("corrupt");
    expect(result.status === "corrupt" && result.quarantinePath).toBe(quarantinePath);
    expect(storage.files.get(quarantinePath)).toBe(truncated);
    // The point of the whole exercise: the unreadable file is still there, unchanged.
    expect(storage.files.get(DOCUMENT_PATH)).toBe(truncated);
    expect(storage.writes).toEqual([]);
  });

  it("carries the kind, path, reason and original text on the error", async () => {
    storage.files.set(DOCUMENT_PATH, '{"units": {}}');

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH, { now: () => AT });

    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") {
      return;
    }
    expect(result.error).toBeInstanceOf(DocumentCorruptError);
    expect(result.error.kind).toBe("voice");
    expect(result.error.path).toBe(DOCUMENT_PATH);
    expect(result.error.reason).toBe("locale is missing");
    expect(result.error.text).toBe('{"units": {}}');
    expect(result.error.message).toContain(DOCUMENT_PATH);
  });

  it("wraps a spec that throws something other than DocumentCorruptError", async () => {
    const throwingSpec = defineDocumentSpec<Library>({
      kind: "localization",
      version: 1,
      paths: ["editor/localization/<locale>.json"],
      parse: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'units')");
      },
      summarize: () => ({ title: "", counts: [] })
    });
    storage.files.set("editor/localization/en.json", "{}");

    const result = await loadDocument(throwingSpec, storage, "editor/localization/en.json", {
      now: () => AT
    });

    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") {
      return;
    }
    expect(result.error).toBeInstanceOf(DocumentCorruptError);
    expect(result.error.kind).toBe("localization");
    expect(result.error.reason).toContain("Cannot read properties of undefined");
    expect(result.error.cause).toBeInstanceOf(TypeError);
    expect(storage.files.get(`.nlstudio/quarantine/${STAMP}/editor/localization/en.json`)).toBe(
      "{}"
    );
  });

  it("still reports corruption when quarantine itself fails", async () => {
    storage.files.set(DOCUMENT_PATH, "{oops");
    storage.failCopy = true;

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH, { now: () => AT });

    expect(result.status).toBe("corrupt");
    expect(result.status === "corrupt" && result.quarantinePath).toBeNull();
    expect(result.status === "corrupt" && (result.quarantineFailure as Error).message).toBe(
      "disk full"
    );
    expect(storage.files.get(DOCUMENT_PATH)).toBe("{oops");
  });

  it("uses the injected clock, so two failures in one session do not collide", async () => {
    storage.files.set(DOCUMENT_PATH, "{oops");
    const later = new Date("2026-07-27T14:32:12.000Z");

    const first = await loadDocument(librarySpec, storage, DOCUMENT_PATH, { now: () => AT });
    const second = await loadDocument(librarySpec, storage, DOCUMENT_PATH, { now: () => later });

    expect(first.status === "corrupt" && first.quarantinePath).toBe(quarantinePath);
    expect(second.status === "corrupt" && second.quarantinePath).toBe(
      `.nlstudio/quarantine/2026-07-27T14-32-12-000Z/${DOCUMENT_PATH}`
    );
  });
});

/**
 * The invariant: `loadDocument` throws only for a broken spec or a failing storage.
 * Nothing about a file's contents can make it throw.
 *
 * A pass-through spec is used deliberately - it sanitises nothing, so any value the
 * bytes can carry reaches `serialize`, which is where the containment used to leak.
 */
describe("loadDocument: no file contents can make it throw", () => {
  const passThroughSpec = defineDocumentSpec<unknown>({
    kind: "story",
    version: 1,
    paths: ["editor/story/index.json"],
    parse: (raw) => raw,
    summarize: () => ({ title: "", counts: [] })
  });
  const PROBE = "editor/story/index.json";

  async function loadContents(text: string) {
    const storage = new MemoryStorage();
    storage.files.set(PROBE, text);
    const result = await loadDocument(passThroughSpec, storage, PROBE, { now: () => AT });
    return { result, storage };
  }

  it("contains a number literal that overflows a double, instead of dying on it", async () => {
    // The reported repro. `JSON.parse` yields Infinity, which no JSON can express.
    const text = '{\n  "a": 1e400\n}\n';
    const { result, storage } = await loadContents(text);

    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") {
      return;
    }
    expect(result.error.reason).toContain("cannot survive a JSON round trip");
    expect(result.error.reason).toContain("Infinity");
    expect(result.error.reason).toContain("at a"); // the offending value is located, not just named
    expect(result.error.text).toBe(text);
    expect(result.quarantinePath).toBe(`.nlstudio/quarantine/${STAMP}/${PROBE}`);
    expect(storage.files.get(result.quarantinePath ?? "")).toBe(text);
    expect(storage.files.get(PROBE)).toBe(text);
    expect(storage.writes).toEqual([]);
  });

  it("contains nesting deeper than the encoder can walk", async () => {
    const { result } = await loadContents(`${"[".repeat(100000)}${"]".repeat(100000)}`);

    expect(result.status).toBe("corrupt");
  });

  it("survives a sweep of hostile file contents", async () => {
    const contents: Record<string, string> = {
      empty: "",
      whitespace: "   \n  ",
      truncatedObject: "{",
      truncatedValue: '{"a":',
      missingValue: '{"a": }',
      trailingComma: '{"a": 1,}',
      bom: "\uFEFF{}",
      notJson: "<html>nope</html>",
      replacementChars: "\uFFFD\uFFFD\uFFFD",
      nullByteInString: '{"a": "x\u0000y"}',
      loneSurrogate: '{"a": "\\ud800"}',
      duplicateKeys: '{"a": 1, "a": 2}',
      protoKey: '{"__proto__": {"polluted": true}}',
      overflowPositive: '{"a": 1e400}',
      overflowNegative: '{"a": -1e400}',
      overflowDigits: `{"a": ${"9".repeat(400)}}`,
      overflowNested: '{"a": [[[{"b": 1e999}]]]}',
      underflow: '{"a": 1e-400, "b": -1e-400}',
      negativeZero: '{"a": -0}',
      scalarString: '"just a string"',
      scalarNumber: "42",
      scalarNull: "null",
      emptyArray: "[]",
      deepNesting: `${"[".repeat(100000)}${"]".repeat(100000)}`,
      wideObject: JSON.stringify(
        Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, i]))
      ),
      longString: `{"a": ${JSON.stringify("x".repeat(200000))}}`
    };

    for (const [name, text] of Object.entries(contents)) {
      const { result, storage } = await loadContents(text);

      expect(["loaded", "corrupt"], name).toContain(result.status);
      // Whatever the verdict, the file itself is never touched.
      expect(storage.files.get(PROBE), name).toBe(text);
      expect(storage.writes, name).toEqual([]);
    }

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("round-trips the contents it does accept", async () => {
    for (const text of [
      "{}",
      "[]",
      "null",
      "42",
      '{"__proto__": 1}',
      '{"a": -0}',
      '{"a": 1e-400}'
    ]) {
      const { result, storage } = await loadContents(text);

      expect(result.status).toBe("loaded");
      if (result.status !== "loaded") {
        continue;
      }
      await saveDocument(passThroughSpec, storage, PROBE, result.document);
      const reloaded = await loadDocument(passThroughSpec, storage, PROBE);
      expect(reloaded.status === "loaded" && reloaded.normalized).toBe(true);
    }
  });

  it("still throws for a broken spec, so the two stay distinguishable", async () => {
    // Clean bytes in, unserialisable document out: nothing in the file explains this,
    // so it is our bug and has to be loud rather than filed as corruption.
    const brokenSpec = defineDocumentSpec<unknown>({
      kind: "voice",
      version: 1,
      paths: ["editor/voice/<locale>.json"],
      parse: () => ({ when: new Date(0) }),
      summarize: () => ({ title: "", counts: [] })
    });
    const storage = new MemoryStorage();
    storage.files.set(DOCUMENT_PATH, '{"locale": "en-US"}');

    await expect(loadDocument(brokenSpec, storage, DOCUMENT_PATH)).rejects.toThrow(/Date/);
    // ...and it does not quarantine, because the author's file is not the problem.
    expect([...storage.files.keys()]).toEqual([DOCUMENT_PATH]);
  });
});

describe("quarantinePathFor", () => {
  it("keeps the original path under a timestamped directory", () => {
    expect(quarantinePathFor("editor/story/stories/abc/storydoc.json", AT)).toBe(
      `.nlstudio/quarantine/${STAMP}/editor/story/stories/abc/storydoc.json`
    );
  });

  it("emits no character Windows refuses in a filename", () => {
    const path = quarantinePathFor(DOCUMENT_PATH, AT);

    expect(path).not.toMatch(/[:*?"<>|]/);
  });

  it("normalises the original path so a Windows path cannot escape the quarantine tree", () => {
    expect(quarantinePathFor("editor\\voice\\en-US.json", AT)).toBe(
      `.nlstudio/quarantine/${STAMP}/${DOCUMENT_PATH}`
    );
    expect(() => quarantinePathFor("../../etc/passwd", AT)).toThrow(DocumentPathError);
  });

  it("refuses an invalid date rather than writing a NaN directory", () => {
    expect(() => quarantinePathFor(DOCUMENT_PATH, new Date("nonsense"))).toThrow();
  });
});

describe("saveDocument", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("writes canonical bytes", async () => {
    await saveDocument(librarySpec, storage, DOCUMENT_PATH, {
      schemaVersion: 2,
      locale: "en-US",
      units: { b: "two", a: "one" }
    });

    expect(storage.files.get(DOCUMENT_PATH)).toBe(
      [
        "{",
        '  "locale": "en-US",',
        '  "schemaVersion": 2,',
        '  "units": {',
        '    "a": "one",',
        '    "b": "two"',
        "  }",
        "}",
        ""
      ].join("\n")
    );
  });

  it("round-trips through load", async () => {
    const document: Library = { schemaVersion: 2, locale: "en-US", units: { a: "one" } };
    await saveDocument(librarySpec, storage, DOCUMENT_PATH, document);

    const result = await loadDocument(librarySpec, storage, DOCUMENT_PATH);

    expect(result).toEqual({ status: "loaded", document, normalized: true });
  });

  it("does not touch the file when serialisation rejects the document", async () => {
    storage.files.set(DOCUMENT_PATH, canonicalLibrary);

    await expect(
      saveDocument(librarySpec, storage, DOCUMENT_PATH, {
        schemaVersion: 2,
        locale: "en-US",
        units: { a: undefined as unknown as string }
      })
    ).rejects.toThrow(/undefined/);

    expect(storage.files.get(DOCUMENT_PATH)).toBe(canonicalLibrary);
    expect(storage.writes).toEqual([]);
  });

  it("rejects a path that is not project-relative", async () => {
    await expect(
      saveDocument(librarySpec, storage, "/etc/passwd", {
        schemaVersion: 2,
        locale: "x",
        units: {}
      })
    ).rejects.toThrow(DocumentPathError);
  });
});
