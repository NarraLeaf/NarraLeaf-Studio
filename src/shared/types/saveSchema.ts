/**
 * Project-level save schema: what one save slot carries besides the engine's own record.
 *
 * A save has always had two channels. The engine writes one of them on every serialize -
 * `lastSentence`, `lastSpeaker`, the stamps, the story hash - and the author writes the other,
 * whatever their save screen needs to show: a chapter name, a place, a play-time, a route flag.
 * The first channel is fixed and readable through the `Get Save …` nodes. The second had no shape
 * at all: `Save Game` took an opaque `json` pin and `Get Save Metadata` handed the same opaque blob
 * back, so an author built the object with `Make JSON Object` and took it apart again with
 * `Get JSON Field` and a string key typed twice. A key typed differently in those two places is not
 * an error anywhere - it reads as nothing, at runtime, on the player's machine.
 *
 * This is that shape. Fields are declared once per project and appear as named pins on both nodes,
 * which is what removes the string key from the author's hands entirely.
 *
 * **Why the project owns it and not the node.** The two nodes are a contract across time: a slot is
 * written today and read back weeks later by a different graph. The skeleton project alone has six
 * write nodes and six read nodes for one save screen; a schema stored per node would be twelve
 * copies to keep in step by hand, and the first one to drift would silently read nothing - exactly
 * the failure the schema exists to remove. So the popover on a node card edits this one document,
 * and every save node in the project grows the same pins from it.
 *
 * Definitions are authoring assets; the VALUES live in each save file's `metadata.user`, keyed by
 * `storageKey`. The schema travels to the runtime baked into the Dev Mode bundle / game pack, and
 * the runtime never mutates it.
 */

import type { LiteralValue } from "./blueprint/document";

/**
 * Persisted schema file version. Independent of the story / blueprint document versions.
 */
export const SAVE_SCHEMA_VERSION = 1 as const;

export type SaveSchemaVersion = typeof SAVE_SCHEMA_VERSION;

/**
 * The types a save field may declare.
 *
 * Deliberately the blueprint pin value types rather than a set of its own, so a field's declared
 * type IS its pin's type and no mapping table sits between the two. Trimmed to what survives a
 * round trip through a JSON file: `Timer`, `AnimationToken` and `any` are live runtime handles that
 * cannot be written to a save and read back as themselves.
 */
export const SAVE_SCHEMA_FIELD_TYPES = ["string", "integer", "float", "boolean", "json", "array"] as const;

export type SaveSchemaFieldType = (typeof SAVE_SCHEMA_FIELD_TYPES)[number];

/**
 * One declared field of a save slot.
 *
 * The shape is deliberately the variable-registry entry shape (`{ id, name, valueType,
 * defaultValue, storageKey }`), because it answers the same questions and the two are read side by
 * side in the editor.
 *
 * `id` is the stable identity: it is what a pin is named after, so renaming a field relabels its
 * pin without disconnecting a single wire. `storageKey` is the key inside `metadata.user` and is
 * fixed when the field is created - a rename must not orphan the values already written into every
 * save on the player's disk.
 */
export type SaveSchemaField = {
    id: string;
    /** Author-facing label. Shown on the pin and in the popover; the id is never displayed. */
    name: string;
    valueType: SaveSchemaFieldType;
    /**
     * What a read answers when the slot carries no value for this field.
     *
     * This is what makes adding a field to a shipped game safe: every save written before the field
     * existed reads as the default rather than as nothing, so a save screen built on it keeps
     * drawing old slots instead of showing blanks.
     */
    defaultValue?: LiteralValue;
    /** Key inside the save's `metadata.user`; set at creation and unchanged by rename. */
    storageKey: string;
    description?: string;
    /** Pin order on the node, low to high. Ties fall back to creation order. */
    order: number;
};

export type SaveSchema = {
    schemaVersion: SaveSchemaVersion;
    /** Keyed by field id. */
    fields: Record<string, SaveSchemaField>;
    meta?: {
        createdAt?: string;
        updatedAt?: string;
    };
};

/**
 * The runtime-facing projection, baked into a bundle / pack from the schema.
 *
 * The full field rather than a narrowed record: `Save Game` needs `storageKey` to write with,
 * `Get Save Metadata` needs `storageKey` and `defaultValue` to read with, and both need `valueType`
 * to coerce. Keeping one shape means the editor and the runtime cannot disagree about a field.
 */
export type SaveSchemaRuntimeTable = SaveSchemaField[];
