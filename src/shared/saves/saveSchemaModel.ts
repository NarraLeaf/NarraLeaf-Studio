/**
 * Pure operations over the project-level save schema: construction, normalization, disk migration,
 * storage-key derivation, and the two conversions the runtime performs at a save's edges. No
 * services, no I/O - unit-testable in isolation.
 */

import type { LiteralValue } from "../types/blueprint/document";
import {
    SAVE_SCHEMA_FIELD_TYPES,
    SAVE_SCHEMA_VERSION,
    type SaveSchema,
    type SaveSchemaField,
    type SaveSchemaFieldType,
    type SaveSchemaRuntimeTable,
} from "../types/saveSchema";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The closed type set, with `string` as the fallback for anything unreadable. */
export function normalizeSaveSchemaFieldType(valueType: unknown): SaveSchemaFieldType {
    return SAVE_SCHEMA_FIELD_TYPES.includes(valueType as SaveSchemaFieldType)
        ? (valueType as SaveSchemaFieldType)
        : "string";
}

/** What a field of each type reads as when a slot carries no value for it and none was configured. */
export function defaultValueForSaveSchemaFieldType(valueType: SaveSchemaFieldType): LiteralValue {
    switch (valueType) {
        case "boolean":
            return false;
        case "integer":
        case "float":
            return 0;
        case "json":
            return {};
        case "array":
            return [];
        default:
            return "";
    }
}

export function createEmptySaveSchema(now?: string): SaveSchema {
    return {
        schemaVersion: SAVE_SCHEMA_VERSION,
        fields: {},
        ...(now ? { meta: { createdAt: now, updatedAt: now } } : {}),
    };
}

/**
 * A field's key inside `metadata.user`, derived from its name.
 *
 * Readable rather than a uuid, because this is what a save file on a player's disk actually looks
 * like and an author debugging one should recognise their own field names in it. Derived once, at
 * creation: {@link SaveSchemaField.storageKey} never follows a rename, or every save already
 * written would stop answering for that field.
 *
 * Falls back to the field id when a name has nothing usable in it (an all-punctuation name, or a
 * name in a script this slug cannot represent) - a key is required, and an unreadable one still
 * works.
 */
export function deriveSaveSchemaStorageKey(name: string, fallbackId: string, taken: Iterable<string>): string {
    const base = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    const seed = base || fallbackId;
    const used = new Set(taken);
    if (!used.has(seed)) {
        return seed;
    }
    for (let n = 2; ; n += 1) {
        const candidate = `${seed}_${n}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

function normalizeField(raw: unknown, id: string, order: number): SaveSchemaField | null {
    if (!isRecord(raw)) {
        return null;
    }
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    const valueType = normalizeSaveSchemaFieldType(raw.valueType);
    const storageKey = typeof raw.storageKey === "string" && raw.storageKey.trim() ? raw.storageKey.trim() : id;
    return {
        id,
        name,
        valueType,
        storageKey,
        order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : order,
        ...(raw.defaultValue === undefined ? {} : { defaultValue: raw.defaultValue as LiteralValue }),
        ...(typeof raw.description === "string" && raw.description ? { description: raw.description } : {}),
    };
}

/**
 * Read a schema document off disk into the current shape.
 *
 * There is only one version so far, so this is a shape gate rather than a migration; it exists now
 * because the alternative is adding one later to a format that already has files in the wild.
 */
export function migrateSaveSchemaToLatest(raw: unknown): SaveSchema {
    if (!isRecord(raw)) {
        return createEmptySaveSchema();
    }
    const fieldsRaw = isRecord(raw.fields) ? raw.fields : {};
    const fields: Record<string, SaveSchemaField> = {};
    let order = 0;
    for (const [id, value] of Object.entries(fieldsRaw)) {
        const field = normalizeField(value, id, order);
        if (field) {
            fields[id] = field;
            order += 1;
        }
    }
    return {
        schemaVersion: SAVE_SCHEMA_VERSION,
        fields,
        ...(isRecord(raw.meta) ? { meta: raw.meta as SaveSchema["meta"] } : {}),
    };
}

/**
 * The schema's fields in pin order.
 *
 * Every consumer that turns fields into pins goes through this, so the write node and the read node
 * cannot disagree about which pin comes first. `order` decides; the id breaks ties so the sequence
 * is stable across reloads rather than dependent on key insertion.
 */
export function listSaveSchemaFields(schema: SaveSchema | null | undefined): SaveSchemaRuntimeTable {
    if (!schema) {
        return [];
    }
    return Object.values(schema.fields).sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
}

/**
 * What a field reads as when the slot carries nothing for it.
 *
 * The author's configured default wins; the type's own empty value is the floor. Never `undefined`,
 * because a pin that resolves to nothing is what this whole schema exists to remove.
 */
export function saveSchemaFieldFallback(field: SaveSchemaField): LiteralValue {
    return field.defaultValue === undefined
        ? defaultValueForSaveSchemaFieldType(field.valueType)
        : field.defaultValue;
}

/**
 * Turn the values a `Save Game` node resolved on its pins into the object stored at
 * `metadata.user`, keyed by storage key.
 *
 * Fields the caller had no value for still land, carrying their fallback: a slot written by a graph
 * that skipped a pin is still a slot with every declared field in it, which is what lets a read
 * treat "the field is missing" as a schema change rather than as a per-slot accident.
 */
export function buildSaveMetadataFromFields(
    fields: SaveSchemaRuntimeTable,
    valuesByFieldId: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
        const value = valuesByFieldId[field.id];
        out[field.storageKey] = value === undefined ? saveSchemaFieldFallback(field) : value;
    }
    return out;
}

/**
 * Read the stored metadata back into values by field id, applying each field's fallback.
 *
 * A slot written before a field existed, a slot written by a graph that predates the schema, and a
 * record whose `metadata.user` is not an object at all all take the same path: every declared field
 * answers with its default rather than with nothing.
 */
export function readSaveMetadataFields(
    fields: SaveSchemaRuntimeTable,
    metadata: unknown,
): Record<string, LiteralValue> {
    const stored = isRecord(metadata) ? metadata : {};
    const out: Record<string, LiteralValue> = {};
    for (const field of fields) {
        const value = stored[field.storageKey];
        out[field.id] = value === undefined ? saveSchemaFieldFallback(field) : (value as LiteralValue);
    }
    return out;
}
