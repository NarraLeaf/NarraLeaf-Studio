import { describe, expect, it } from "vitest";
import { SAVE_SCHEMA_VERSION, type SaveSchema, type SaveSchemaField } from "../types/saveSchema";
import {
    buildSaveMetadataFromFields,
    createEmptySaveSchema,
    defaultValueForSaveSchemaFieldType,
    deriveSaveSchemaStorageKey,
    listSaveSchemaFields,
    migrateSaveSchemaToLatest,
    normalizeSaveSchemaFieldType,
    readSaveMetadataFields,
    saveSchemaFieldFallback,
} from "./saveSchemaModel";

function field(patch: Partial<SaveSchemaField> & { id: string }): SaveSchemaField {
    return {
        name: patch.id,
        valueType: "string",
        storageKey: patch.id,
        order: 0,
        ...patch,
    };
}

function schemaOf(...fields: SaveSchemaField[]): SaveSchema {
    return {
        schemaVersion: SAVE_SCHEMA_VERSION,
        fields: Object.fromEntries(fields.map(f => [f.id, f])),
    };
}

describe("normalizeSaveSchemaFieldType", () => {
    it("keeps the six JSON-safe types", () => {
        for (const type of ["string", "integer", "float", "boolean", "json", "array"] as const) {
            expect(normalizeSaveSchemaFieldType(type)).toBe(type);
        }
    });

    it("falls back to string for the runtime-handle types a save cannot carry", () => {
        // These are live handles in a running graph; writing one to a file and reading it back
        // cannot produce the same thing, so a schema that named one would promise what it cannot keep.
        expect(normalizeSaveSchemaFieldType("Timer")).toBe("string");
        expect(normalizeSaveSchemaFieldType("AnimationToken")).toBe("string");
        expect(normalizeSaveSchemaFieldType("any")).toBe("string");
        expect(normalizeSaveSchemaFieldType(undefined)).toBe("string");
    });
});

describe("deriveSaveSchemaStorageKey", () => {
    it("slugs the name so a save file reads in the author's own words", () => {
        expect(deriveSaveSchemaStorageKey("Chapter Name", "id-1", [])).toBe("chapter_name");
        expect(deriveSaveSchemaStorageKey("  Play Time!  ", "id-1", [])).toBe("play_time");
    });

    it("uniquifies against keys already taken", () => {
        expect(deriveSaveSchemaStorageKey("Chapter", "id-2", ["chapter"])).toBe("chapter_2");
        expect(deriveSaveSchemaStorageKey("Chapter", "id-3", ["chapter", "chapter_2"])).toBe("chapter_3");
    });

    it("falls back to the field id when the name slugs to nothing", () => {
        // A name in a script this slug cannot represent, or pure punctuation. A key is required and
        // an unreadable one still works; no key at all would lose the field's values entirely.
        expect(deriveSaveSchemaStorageKey("章节名", "id-4", [])).toBe("id-4");
        expect(deriveSaveSchemaStorageKey("!!!", "id-5", [])).toBe("id-5");
    });
});

describe("migrateSaveSchemaToLatest", () => {
    it("reads a well-formed document unchanged", () => {
        const schema = schemaOf(field({ id: "a", name: "Chapter", storageKey: "chapter", order: 3 }));
        expect(migrateSaveSchemaToLatest(schema)).toEqual(schema);
    });

    it("answers with an empty schema for anything that is not a document", () => {
        expect(migrateSaveSchemaToLatest(null).fields).toEqual({});
        expect(migrateSaveSchemaToLatest("nonsense").fields).toEqual({});
        expect(migrateSaveSchemaToLatest([]).fields).toEqual({});
    });

    it("keys every field by its map key, whatever the record says", () => {
        // The map key is what a pin is named after, so a record whose inner `id` disagrees with it
        // would grow a pin nothing else in the project can address.
        const migrated = migrateSaveSchemaToLatest({
            schemaVersion: 1,
            fields: { real: { id: "stale", name: "Chapter", valueType: "string", storageKey: "chapter", order: 0 } },
        });
        expect(Object.keys(migrated.fields)).toEqual(["real"]);
        expect(migrated.fields.real.id).toBe("real");
    });

    it("fills in what a hand-edited record left out", () => {
        const migrated = migrateSaveSchemaToLatest({ schemaVersion: 1, fields: { a: {} } });
        expect(migrated.fields.a).toEqual({ id: "a", name: "a", valueType: "string", storageKey: "a", order: 0 });
    });
});

describe("listSaveSchemaFields", () => {
    it("orders by `order`, then by id so the sequence survives a reload", () => {
        const schema = schemaOf(
            field({ id: "c", order: 1 }),
            field({ id: "a", order: 0 }),
            field({ id: "b", order: 1 }),
        );
        expect(listSaveSchemaFields(schema).map(f => f.id)).toEqual(["a", "b", "c"]);
    });

    it("answers empty for a project that has declared nothing", () => {
        expect(listSaveSchemaFields(null)).toEqual([]);
        expect(listSaveSchemaFields(createEmptySaveSchema())).toEqual([]);
    });
});

describe("saveSchemaFieldFallback", () => {
    it("prefers the author's configured default", () => {
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "string", defaultValue: "Prologue" })))
            .toBe("Prologue");
    });

    it("falls back to the type's own empty value", () => {
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "boolean" }))).toBe(false);
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "integer" }))).toBe(0);
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "array" }))).toEqual([]);
        expect(defaultValueForSaveSchemaFieldType("json")).toEqual({});
    });

    it("keeps a configured default that is falsy", () => {
        // `0`, `false` and `""` are values an author picks on purpose; treating them as "unset"
        // would quietly substitute the type default for the one they chose.
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "integer", defaultValue: 0 }))).toBe(0);
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "boolean", defaultValue: false }))).toBe(false);
        expect(saveSchemaFieldFallback(field({ id: "a", valueType: "string", defaultValue: "" }))).toBe("");
    });
});

describe("buildSaveMetadataFromFields", () => {
    const fields = [
        field({ id: "f1", storageKey: "chapter", valueType: "string", defaultValue: "Prologue" }),
        field({ id: "f2", storageKey: "play_time", valueType: "integer", order: 1 }),
    ];

    it("writes by storage key, not by field id", () => {
        // The id is a uuid that means nothing outside the project; the key is what an author reading
        // their own save file sees.
        expect(buildSaveMetadataFromFields(fields, { f1: "Chapter 2", f2: 120 }))
            .toEqual({ chapter: "Chapter 2", play_time: 120 });
    });

    it("still writes every declared field when the graph supplied none", () => {
        // A slot with every field in it is what lets a read treat a missing key as a schema change
        // rather than as this one slot being written by a graph that skipped a pin.
        expect(buildSaveMetadataFromFields(fields, {})).toEqual({ chapter: "Prologue", play_time: 0 });
    });
});

describe("readSaveMetadataFields", () => {
    const fields = [
        field({ id: "f1", storageKey: "chapter", valueType: "string", defaultValue: "Prologue" }),
        field({ id: "f2", storageKey: "play_time", valueType: "integer", order: 1 }),
    ];

    it("reads back by field id, so a pin is addressed by identity", () => {
        expect(readSaveMetadataFields(fields, { chapter: "Chapter 2", play_time: 120 }))
            .toEqual({ f1: "Chapter 2", f2: 120 });
    });

    it("gives a field declared after the save was written its configured default", () => {
        // This is what makes adding a field to a shipped game safe: old slots keep drawing.
        expect(readSaveMetadataFields(fields, { chapter: "Chapter 2" }))
            .toEqual({ f1: "Chapter 2", f2: 0 });
    });

    it("treats a save with no author metadata at all as every field defaulted", () => {
        for (const stored of [undefined, null, "not an object", []]) {
            expect(readSaveMetadataFields(fields, stored)).toEqual({ f1: "Prologue", f2: 0 });
        }
    });
});
