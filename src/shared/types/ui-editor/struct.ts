/**
 * Named record shapes a project's documents can describe their data with.
 *
 * A struct is what a list item, a page prop bag or a fetched record *is*, written down once: an
 * ordered set of named, typed fields. Before it there was only `json`, which says a value is an
 * object and nothing else - so every read went through a dotted path typed into a string pin, every
 * write through a field name nobody checked, and the editor had no way to show an author what a row
 * even contains. Every affordance that replaced those (the item table, the field picker on a value
 * binding, the typed pins on Break/Make) reads exactly this record and nothing else.
 *
 * # Why the library is implicit
 *
 * Structs live in the document, keyed by id, but no authoring surface manages them. An author edits
 * fields on the widget that uses them and never learns the library exists. Two rules keep that
 * honest:
 *
 *  - **Copy on write.** Editing the fields of a struct that more than one owner references forks it
 *    first (see `forkStructForEdit`). Editing one list can therefore never reshape another, which is
 *    the whole promise of "it is declared on this widget".
 *  - **Compatibility is structural, never by id.** Two structs with the same fields are the same
 *    type (`structsAreCompatible`), so a fork does not sever a wire and two lists that happen to
 *    agree can feed each other. An id is storage, not identity.
 *
 * Comments in English per project convention.
 */

/**
 * The field types an author can pick.
 *
 * Deliberately short. Each entry has to earn a cell editor in the item table, a pin value type, a
 * coercion rule and a translation - so a type is added when a widget cannot express something
 * without it, not because a JavaScript value of that shape exists.
 *
 * `json` is the escape hatch and stays: a record arriving from `Fetch` or from save metadata has a
 * shape this project never declared, and a field that refuses to hold it would push the author back
 * onto the untyped path this model exists to replace.
 */
export const UI_STRUCT_FIELD_TYPES = ["string", "number", "boolean", "image", "color", "json"] as const;

export type UIStructFieldType = (typeof UI_STRUCT_FIELD_TYPES)[number];

export type UIStructField = {
    /**
     * Stable identity. Value bindings, node params and generated pins all address a field by this,
     * so renaming `key` costs nothing and reshuffling the list costs nothing.
     */
    id: string;
    /** The property name this field occupies inside an item object. */
    key: string;
    /**
     * What the author called it, shown in the item table header and in every field picker.
     *
     * Optional because `key` is usually already the readable name; a label is what lets a field
     * whose key has to stay ASCII (it travels in JSON to a plugin, a save file, a story variable)
     * still read as words in the editor.
     */
    label?: string;
    type: UIStructFieldType;
};

export type UIStructId = string;

export type UIStructDef = {
    id: UIStructId;
    fields: UIStructField[];
};

/** How a struct-typed value is spelled on a blueprint data pin. */
export const UI_STRUCT_VALUE_TYPE_PREFIX = "struct:" as const;

export function uiStructValueType(structId: UIStructId | null | undefined): string {
    const safe = structId?.trim();
    return safe ? `${UI_STRUCT_VALUE_TYPE_PREFIX}${safe}` : "json";
}

export function uiStructIdFromValueType(valueType: string | undefined): UIStructId | null {
    if (!valueType?.startsWith(UI_STRUCT_VALUE_TYPE_PREFIX)) {
        return null;
    }
    const id = valueType.slice(UI_STRUCT_VALUE_TYPE_PREFIX.length).trim();
    return id || null;
}

/** The blueprint pin value type one field carries. */
export function uiStructFieldValueType(type: UIStructFieldType): string {
    switch (type) {
        case "string":
            return "string";
        case "number":
            return "float";
        case "boolean":
            return "boolean";
        case "image":
            // The same envelope every other image-bearing pin uses, so a picture picked on an Image
            // Asset node drops straight into an item field and the asset walks (reference index,
            // preloader, build slot writer) find it without being told about structs at all.
            return "ImageAsset|null";
        case "color":
            return "RGBAColor";
        case "json":
            return "json";
    }
}

/** Whether a field's stored value may be typed into the node card / table cell directly. */
export function uiStructFieldAcceptsInlineLiteral(type: UIStructFieldType): boolean {
    return type === "string" || type === "number" || type === "boolean";
}

export function isUIStructFieldType(value: unknown): value is UIStructFieldType {
    return typeof value === "string" && (UI_STRUCT_FIELD_TYPES as readonly string[]).includes(value);
}

function safeText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

export function normalizeUIStructField(value: unknown): UIStructField | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const raw = value as Partial<UIStructField>;
    const id = safeText(raw.id);
    const key = safeText(raw.key);
    if (!id || !key) {
        return null;
    }
    const label = safeText(raw.label);
    return {
        id,
        key,
        type: isUIStructFieldType(raw.type) ? raw.type : "string",
        ...(label ? { label } : {}),
    };
}

/**
 * A struct read off disk, with unreadable fields dropped and duplicate keys resolved.
 *
 * Duplicates are dropped rather than renamed: two fields claiming one key cannot both be written
 * into an item, and inventing `title_2` would put a field in the table that no stored row has ever
 * had a value for. First declaration wins, so the older wiring is the one that keeps working.
 */
export function normalizeUIStructDef(value: unknown): UIStructDef | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const raw = value as Partial<UIStructDef>;
    const id = safeText(raw.id);
    if (!id) {
        return null;
    }
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const fields: UIStructField[] = [];
    for (const entry of Array.isArray(raw.fields) ? raw.fields : []) {
        const field = normalizeUIStructField(entry);
        if (!field || seenIds.has(field.id) || seenKeys.has(field.key)) {
            continue;
        }
        seenIds.add(field.id);
        seenKeys.add(field.key);
        fields.push(field);
    }
    return { id, fields };
}

export function normalizeUIStructTable(value: unknown): Record<UIStructId, UIStructDef> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const out: Record<UIStructId, UIStructDef> = {};
    for (const entry of Object.values(value as Record<string, unknown>)) {
        const struct = normalizeUIStructDef(entry);
        if (struct) {
            out[struct.id] = struct;
        }
    }
    return out;
}

/**
 * Whether two structs describe the same shape.
 *
 * Field **order matters**: it is the order of the columns in the item table and of the pins on a
 * Break node, so two structs that differ only by order would silently reorder a card's pins if they
 * were treated as one type. Field **ids do not**: an id is per-struct storage, and a fork mints new
 * ones while describing the identical shape.
 */
export function structsAreCompatible(a: UIStructDef | null | undefined, b: UIStructDef | null | undefined): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b || a.fields.length !== b.fields.length) {
        return false;
    }
    return a.fields.every((field, index) => {
        const other = b.fields[index]!;
        return field.key === other.key && field.type === other.type;
    });
}

export function findUIStructField(
    struct: UIStructDef | null | undefined,
    fieldId: string | null | undefined,
): UIStructField | null {
    const id = safeText(fieldId);
    if (!id || !struct) {
        return null;
    }
    return struct.fields.find(field => field.id === id) ?? null;
}

/** What an author sees for a field: their label, or the key it is stored under. */
export function uiStructFieldLabel(field: UIStructField): string {
    return field.label?.trim() || field.key;
}

/**
 * The value a field holds before anyone has written one.
 *
 * Empty rather than absent, so a row added to the item table has a cell in every column and a
 * widget bound to a field never has to distinguish "no value yet" from "the field does not exist".
 */
export function defaultUIStructFieldValue(type: UIStructFieldType): unknown {
    switch (type) {
        case "string":
            return "";
        case "number":
            return 0;
        case "boolean":
            return false;
        case "image":
            return null;
        case "color":
            return null;
        case "json":
            return null;
    }
}

function coerceNumber(value: unknown): number {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function coerceImage(value: unknown): unknown {
    if (typeof value === "string") {
        const id = value.trim();
        return id ? { kind: "imageAsset", assetId: id } : null;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const id = safeText(record.assetId);
        return id ? { kind: "imageAsset", assetId: id } : null;
    }
    return null;
}

/**
 * One field's stored value, read as the type the field declares.
 *
 * Lenient on purpose. Items reach a list from a blueprint, from page props, from a fetched
 * response - places this document does not control - and a strict reader would answer "no value"
 * for a number that arrived as `"3"`, which is indistinguishable on screen from a field the author
 * forgot to fill. What cannot be read at all falls back to the type's empty value, and the same
 * mismatch is reported once, as a diagnostic, where it can be acted on.
 */
export function coerceUIStructFieldValue(type: UIStructFieldType, value: unknown): unknown {
    if (value === undefined) {
        return defaultUIStructFieldValue(type);
    }
    switch (type) {
        case "string":
            return typeof value === "string" ? value : value === null ? "" : String(value);
        case "number":
            return coerceNumber(value);
        case "boolean":
            return typeof value === "boolean" ? value : Boolean(value);
        case "image":
            return coerceImage(value);
        case "color":
            return value ?? null;
        case "json":
            return value ?? null;
    }
}

/** An item with a cell for every declared field, and nothing the struct does not declare removed. */
export function coerceItemToStruct(struct: UIStructDef | null | undefined, item: unknown): Record<string, unknown> {
    const source = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    if (!struct) {
        return { ...source };
    }
    const out: Record<string, unknown> = {};
    for (const field of struct.fields) {
        out[field.key] = coerceUIStructFieldValue(field.type, source[field.key]);
    }
    // Undeclared keys ride along untouched. A list whose items come from `Fetch` or from a plugin
    // carries more than the author chose to declare, and dropping the rest here would make
    // declaring one field to bind a label quietly destroy the payload the rest of the graph reads.
    for (const [key, value] of Object.entries(source)) {
        if (!(key in out)) {
            out[key] = value;
        }
    }
    return out;
}

/** A fresh item with every declared field at its empty value. */
export function makeDefaultStructItem(struct: UIStructDef | null | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of struct?.fields ?? []) {
        out[field.key] = defaultUIStructFieldValue(field.type);
    }
    return out;
}

/**
 * Read one field out of an item.
 *
 * By key, because that is what the item actually stores; the field id only ever addresses the
 * *declaration*. A field that was renamed therefore reads the new key and finds nothing, which is
 * correct - the stored rows still hold the old one until they are rewritten.
 */
export function readUIStructFieldValue(
    struct: UIStructDef | null | undefined,
    fieldId: string | null | undefined,
    item: unknown,
): unknown {
    const field = findUIStructField(struct, fieldId);
    if (!field) {
        return undefined;
    }
    const source = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
    return coerceUIStructFieldValue(field.type, source ? source[field.key] : undefined);
}

/** Structural equality for two field values, which may be records (an image envelope, a json bag). */
function structValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/**
 * Order two field values.
 *
 * Numbers compare as numbers and everything else as text, which is what makes "sort the slots by
 * save time" and "sort the gallery by title" the same node. A row missing the field sorts last in
 * either direction: it has no place in the ordering, and putting it first would push the rows the
 * author sorted for off the top of the list.
 */
function compareFieldValues(a: unknown, b: unknown): number {
    const aMissing = a === undefined || a === null || a === "";
    const bMissing = b === undefined || b === null || b === "";
    if (aMissing || bMissing) {
        return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    }
    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }
    if (typeof a === "boolean" && typeof b === "boolean") {
        return Number(a) - Number(b);
    }
    return String(a).localeCompare(String(b));
}

export function sortItemsByField(
    items: readonly unknown[],
    struct: UIStructDef | null,
    fieldId: string,
    descending: boolean,
): unknown[] {
    const field = findUIStructField(struct, fieldId);
    if (!field) {
        return [...items];
    }
    const read = (item: unknown): unknown =>
        item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)[field.key]
            : undefined;
    // Decorated with the original position so equal keys keep the order the author wrote them in.
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const ordered = compareFieldValues(read(a.item), read(b.item));
            return ordered !== 0 ? (descending ? -ordered : ordered) : a.index - b.index;
        })
        .map(entry => entry.item);
}

export function findItemIndexByField(
    items: readonly unknown[],
    struct: UIStructDef | null,
    fieldId: string,
    value: unknown,
): number {
    const field = findUIStructField(struct, fieldId);
    if (!field) {
        return -1;
    }
    const wanted = coerceUIStructFieldValue(field.type, value);
    return items.findIndex(item => {
        const stored = item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>)[field.key]
            : undefined;
        return structValuesEqual(coerceUIStructFieldValue(field.type, stored), wanted);
    });
}
