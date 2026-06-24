import type { BlueprintJsonValueSchema } from "@/lib/ui-editor/blueprint-nodes/types";

export type JsonValue = null | string | number | boolean | JsonArray | JsonObject;
export type JsonArray = JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";
export type JsonPathSegment = string | number;
export type JsonPath = JsonPathSegment[];

export function isJsonObject(value: JsonValue): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (value === undefined) {
        return null;
    }
    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        return String(value);
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) {
            return null;
        }
        seen.add(value);
        const out = value.map(item => normalizeJsonValue(item, seen));
        seen.delete(value);
        return out;
    }
    if (typeof value === "object") {
        if (seen.has(value)) {
            return null;
        }
        seen.add(value);
        const out: JsonObject = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            out[key] = normalizeJsonValue(child, seen);
        }
        seen.delete(value);
        return out;
    }
    return null;
}

export function getJsonValueKind(value: JsonValue): JsonValueKind {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    if (typeof value === "object") {
        return "object";
    }
    if (typeof value === "string") {
        return "string";
    }
    if (typeof value === "number") {
        return "number";
    }
    if (typeof value === "boolean") {
        return "boolean";
    }
    return "null";
}

export function createJsonValueForKind(kind: JsonValueKind): JsonValue {
    switch (kind) {
        case "object":
            return {};
        case "array":
            return [];
        case "string":
            return "";
        case "number":
            return 0;
        case "boolean":
            return false;
        case "null":
            return null;
        default:
            return null;
    }
}

function defaultJsonValueForSchemaKind(kind: JsonValueKind): JsonValue {
    return createJsonValueForKind(kind);
}

function schemaFieldToValueSchema(
    field: NonNullable<BlueprintJsonValueSchema["fields"]>[number],
): BlueprintJsonValueSchema {
    return {
        kind: field.kind,
        label: field.label,
    };
}

function findSchemaField(schema: BlueprintJsonValueSchema | undefined, key: string) {
    return schema?.kind === "object" ? schema.fields?.find(field => field.key === key) : undefined;
}

export function getJsonSchemaAtPath(
    schema: BlueprintJsonValueSchema | undefined,
    path: JsonPath,
): BlueprintJsonValueSchema | undefined {
    if (!schema) {
        return undefined;
    }
    let current: BlueprintJsonValueSchema | undefined = schema;
    for (const segment of path) {
        if (!current) {
            return undefined;
        }
        if (current.kind === "object" && typeof segment === "string") {
            const field = findSchemaField(current, segment);
            current = field ? schemaFieldToValueSchema(field) : undefined;
            continue;
        }
        return undefined;
    }
    return current;
}

export function validateJsonValueAgainstSchema(
    input: unknown,
    schema: BlueprintJsonValueSchema | undefined,
    path = "$",
): { ok: true } | { ok: false; message: string } {
    if (!schema) {
        return { ok: true };
    }
    const value = normalizeJsonValue(input);
    const actualKind = getJsonValueKind(value);
    if (actualKind !== schema.kind) {
        return { ok: false, message: `${path} must be ${schema.kind}` };
    }
    if (schema.kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
        return { ok: false, message: `${path} must be a finite number` };
    }
    if (schema.kind !== "object") {
        return { ok: true };
    }
    if (!isJsonObject(value)) {
        return { ok: false, message: `${path} must be object` };
    }
    const fields = schema.fields ?? [];
    for (const field of fields) {
        const hasField = Object.prototype.hasOwnProperty.call(value, field.key);
        if (!hasField) {
            if (field.required) {
                return { ok: false, message: `${path}.${field.key} is required` };
            }
            continue;
        }
        const childSchema = schemaFieldToValueSchema(field);
        const result = validateJsonValueAgainstSchema(value[field.key], childSchema, `${path}.${field.key}`);
        if (!result.ok) {
            return result;
        }
    }
    if (schema.allowExtraFields !== true) {
        const known = new Set(fields.map(field => field.key));
        const extra = Object.keys(value).find(key => !known.has(key));
        if (extra) {
            return { ok: false, message: `${path}.${extra} is not allowed` };
        }
    }
    return { ok: true };
}

export function coerceJsonValueToSchema(
    input: unknown,
    schema: BlueprintJsonValueSchema | undefined,
): JsonValue {
    const value = normalizeJsonValue(input);
    if (!schema) {
        return value;
    }
    if (schema.kind === "object") {
        const object = isJsonObject(value) ? value : {};
        const out: JsonObject = {};
        const fields = schema.fields ?? [];
        for (const field of fields) {
            const childSchema = schemaFieldToValueSchema(field);
            out[field.key] = coerceJsonValueToSchema(object[field.key], childSchema);
        }
        if (schema.allowExtraFields === true) {
            const known = new Set(fields.map(field => field.key));
            for (const [key, child] of Object.entries(object)) {
                if (!known.has(key)) {
                    out[key] = normalizeJsonValue(child);
                }
            }
        }
        return out;
    }
    if (schema.kind === "array") {
        return Array.isArray(value) ? value : [];
    }
    if (schema.kind === "string") {
        return typeof value === "string" ? value : "";
    }
    if (schema.kind === "number") {
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    }
    if (schema.kind === "boolean") {
        return typeof value === "boolean" ? value : false;
    }
    if (schema.kind === "null") {
        return null;
    }
    return defaultJsonValueForSchemaKind(schema.kind);
}

function truncateText(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}...` : value;
}

export function summarizeJsonValue(input: unknown): string {
    const value = normalizeJsonValue(input);
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return `"${truncateText(value, 34)}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "[]";
        }
        return `[${value.length} item${value.length === 1 ? "" : "s"}]`;
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
        return "{}";
    }
    const shown = keys.slice(0, 3).join(", ");
    return keys.length > 3 ? `{ ${shown}, +${keys.length - 3} }` : `{ ${shown} }`;
}

function makeUniqueObjectKey(object: JsonObject, prefix: string): string {
    if (!Object.prototype.hasOwnProperty.call(object, prefix)) {
        return prefix;
    }
    let n = 2;
    for (;;) {
        const candidate = `${prefix}${n}`;
        if (!Object.prototype.hasOwnProperty.call(object, candidate)) {
            return candidate;
        }
        n += 1;
    }
}

export function addJsonObjectField(input: unknown, preferredKey = "field"): { value: JsonObject; key: string } {
    const normalized = normalizeJsonValue(input);
    const object = isJsonObject(normalized) ? normalized : {};
    const key = makeUniqueObjectKey(object, preferredKey);
    return { value: { ...object, [key]: null }, key };
}

export function renameJsonObjectField(
    input: unknown,
    oldKey: string,
    nextKey: string,
): { value: JsonObject; committed: boolean; error?: "empty" | "duplicate" | "missing" } {
    const normalized = normalizeJsonValue(input);
    const object = isJsonObject(normalized) ? normalized : {};
    const trimmed = nextKey.trim();
    if (!trimmed) {
        return { value: object, committed: false, error: "empty" };
    }
    if (!Object.prototype.hasOwnProperty.call(object, oldKey)) {
        return { value: object, committed: false, error: "missing" };
    }
    if (trimmed !== oldKey && Object.prototype.hasOwnProperty.call(object, trimmed)) {
        return { value: object, committed: false, error: "duplicate" };
    }
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(object)) {
        out[key === oldKey ? trimmed : key] = value;
    }
    return { value: out, committed: true };
}

export function removeJsonObjectField(input: unknown, keyToRemove: string): JsonObject {
    const normalized = normalizeJsonValue(input);
    const object = isJsonObject(normalized) ? normalized : {};
    const out: JsonObject = {};
    for (const [key, value] of Object.entries(object)) {
        if (key !== keyToRemove) {
            out[key] = value;
        }
    }
    return out;
}

export function addJsonArrayItem(input: unknown): JsonArray {
    const normalized = normalizeJsonValue(input);
    const array = Array.isArray(normalized) ? normalized : [];
    return [...array, null];
}

export function removeJsonArrayItem(input: unknown, index: number): JsonArray {
    const normalized = normalizeJsonValue(input);
    const array = Array.isArray(normalized) ? normalized : [];
    return array.filter((_, i) => i !== index);
}

export function moveJsonArrayItem(input: unknown, fromIndex: number, toIndex: number): JsonArray {
    const normalized = normalizeJsonValue(input);
    const array = Array.isArray(normalized) ? [...normalized] : [];
    if (
        fromIndex < 0 ||
        fromIndex >= array.length ||
        toIndex < 0 ||
        toIndex >= array.length ||
        fromIndex === toIndex
    ) {
        return array;
    }
    const [item] = array.splice(fromIndex, 1);
    array.splice(toIndex, 0, item ?? null);
    return array;
}

export function getJsonValueAtPath(rootInput: unknown, path: JsonPath): JsonValue | undefined {
    let current: JsonValue | undefined = normalizeJsonValue(rootInput);
    for (const segment of path) {
        if (typeof segment === "number") {
            current = Array.isArray(current) ? current[segment] : undefined;
        } else {
            current = current && isJsonObject(current) ? current[segment] : undefined;
        }
        if (current === undefined) {
            return undefined;
        }
    }
    return current;
}

export function setJsonValueAtPath(rootInput: unknown, path: JsonPath, nextInput: unknown): JsonValue {
    const root = normalizeJsonValue(rootInput);
    const next = normalizeJsonValue(nextInput);
    if (path.length === 0) {
        return next;
    }
    const [head, ...tail] = path;
    if (typeof head === "number") {
        const array = Array.isArray(root) ? [...root] : [];
        array[head] = setJsonValueAtPath(array[head] ?? null, tail, next);
        return array;
    }
    const object = isJsonObject(root) ? { ...root } : {};
    object[head] = setJsonValueAtPath(object[head] ?? null, tail, next);
    return object;
}
