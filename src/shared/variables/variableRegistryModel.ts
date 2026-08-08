/**
 * Pure operations over the project-level variable registry (M-VAR): construction, value-type
 * normalization, disk migration, and the seed from the legacy `BlueprintDocument.persistentVariables`
 * field. No services, no I/O - unit-testable in isolation.
 */

import type { BlueprintPersistentVariable } from "../types/blueprint/document";
import type { StoryVariableValueType } from "../types/story/document";
import {
    VARIABLE_REGISTRY_SCHEMA_VERSION,
    type PersistentVariableRuntimeTable,
    type SavedVariableRuntimeTable,
    type VariableRegistry,
    type VariableRegistryEntry,
    type VariableRegistryScope,
} from "../types/variables/registry";

/** The 4-value closed set persistent variables converge to. */
export function normalizePersistentValueType(valueType: string | undefined): StoryVariableValueType {
    return valueType === "boolean" || valueType === "number" || valueType === "string" ? valueType : "json";
}

/**
 * The scope closed set, with `persistent` as the fallback.
 *
 * Not a neutral default: every entry written before schema v2 was a persistent variable, because
 * that was the only kind the registry held. Reading a scope-less entry as anything else would move
 * an author's existing variables to a different store on first load.
 */
export function normalizeVariableRegistryScope(scope: unknown): VariableRegistryScope {
    return scope === "saved" ? "saved" : "persistent";
}

export function createEmptyVariableRegistry(now?: string): VariableRegistry {
    return {
        schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
        entries: {},
        ...(now ? { meta: { createdAt: now, updatedAt: now } } : {}),
    };
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A registry entry from a legacy blueprint persistent variable.
 *
 * The entry `id` takes over the old `storageKey` (not the old blueprint `id`) so that the story
 * document's `StoryVariableRef` persistent arm - which addresses by `storageKey` - resolves to this
 * entry directly, and WI-4's later storageKey→variableId symmetrization is a no-op rename. In
 * practice `id === storageKey` already (the blueprint factory sets `storageKey: id`), so this only
 * matters for hand-edited documents where they diverged.
 */
export function registryEntryFromBlueprintPersistent(v: BlueprintPersistentVariable): VariableRegistryEntry {
    const storageKey = v.storageKey?.trim() || v.id;
    return {
        id: storageKey,
        name: v.name,
        // The legacy field held persistent variables and nothing else; there is no scope to read.
        scope: "persistent",
        valueType: normalizePersistentValueType(v.valueType),
        ...withDefaultValue(v.defaultValue),
        storageKey,
    };
}

/**
 * `{ defaultValue }` only when there is one - never `{ defaultValue: undefined }`.
 *
 * A variable with no default is the common case, and the two spellings are indistinguishable in
 * TypeScript. They are not indistinguishable on the way to disk: `JSON.stringify` drops the
 * property in silence, while the canonical encoder rejects the document by name. Assigning the
 * undefined would make every default-less variable an unsaveable registry.
 */
function withDefaultValue(value: unknown): Pick<VariableRegistryEntry, "defaultValue"> {
    return value === undefined ? {} : { defaultValue: value as VariableRegistryEntry["defaultValue"] };
}

/**
 * Build registry entries from the legacy `BlueprintDocument.persistentVariables` map. Returns the
 * entries keyed by their (storageKey-derived) id, plus the id remap the blueprint migration applies
 * to every `persistentVariableId` node param so runtime lookups keep resolving.
 */
export function seedRegistryEntriesFromBlueprintPersistent(
    persistentVariables: Record<string, BlueprintPersistentVariable> | undefined,
): { entries: Record<string, VariableRegistryEntry>; idRemap: Record<string, string> } {
    const entries: Record<string, VariableRegistryEntry> = {};
    const idRemap: Record<string, string> = {};
    for (const [oldId, v] of Object.entries(persistentVariables ?? {})) {
        if (!isRecord(v) || typeof v.storageKey !== "string" || typeof v.id !== "string") {
            continue;
        }
        const entry = registryEntryFromBlueprintPersistent(v);
        entries[entry.id] = entry;
        if (oldId !== entry.id) {
            idRemap[oldId] = entry.id;
        }
    }
    return { entries, idRemap };
}

/**
 * Load-time migration for the registry file. Newer-than-latest is refused by the caller.
 *
 * One normalizing pass rather than a chain of per-version steps: every field is re-derived from the
 * raw record and the current version is stamped unconditionally, so a v1 file and a hand-edited v2
 * file converge on the same shape. The consequence is that anything NOT read here is dropped in
 * silence - which is why `scope` must be read even though v1 files have none.
 */
export function migrateVariableRegistryToLatest(raw: unknown): VariableRegistry {
    if (!isRecord(raw)) {
        throw new Error("VariableRegistry: expected object");
    }
    const entries: Record<string, VariableRegistryEntry> = {};
    const rawEntries = isRecord(raw.entries) ? raw.entries : {};
    for (const [id, value] of Object.entries(rawEntries)) {
        if (!isRecord(value) || typeof value.storageKey !== "string" || typeof value.name !== "string") {
            continue;
        }
        entries[id] = {
            id,
            name: value.name,
            scope: normalizeVariableRegistryScope(value.scope),
            valueType: normalizePersistentValueType(typeof value.valueType === "string" ? value.valueType : undefined),
            ...withDefaultValue(value.defaultValue),
            storageKey: value.storageKey,
            ...(typeof value.description === "string" ? { description: value.description } : {}),
        };
    }
    return {
        schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
        entries,
        ...(isRecord(raw.meta) ? { meta: raw.meta as VariableRegistry["meta"] } : {}),
    };
}

/**
 * Registry entries sorted by name (the order the member tree / variable panel present them in),
 * optionally narrowed to one scope. The sort is applied after the filter, so a scoped list reads
 * identically to the full one minus the other scope's rows.
 */
export function listRegistryEntries(registry: VariableRegistry, scope?: VariableRegistryScope): VariableRegistryEntry[] {
    const all = Object.values(registry.entries);
    const selected = scope ? all.filter(entry => entry.scope === scope) : all;
    return selected.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The persistent runtime table baked into a bundle/pack; keyed by entry id (= the node
 * `persistentVariableId`). Filtered by scope, not a plain copy: saved entries share this registry
 * but are backed by the save file, and letting one through here would hand the persistent channel a
 * key it would then write to app-level storage.
 */
export function buildPersistentRuntimeTable(registry: VariableRegistry): PersistentVariableRuntimeTable {
    return runtimeTableForScope(registry, "persistent");
}

/** The saved runtime table; keyed by entry id (= the node `savedVariableId`). */
export function buildSavedRuntimeTable(registry: VariableRegistry): SavedVariableRuntimeTable {
    return runtimeTableForScope(registry, "saved");
}

function runtimeTableForScope(
    registry: VariableRegistry,
    scope: VariableRegistryScope,
): Record<string, VariableRegistryEntry> {
    const table: Record<string, VariableRegistryEntry> = {};
    for (const [id, entry] of Object.entries(registry.entries)) {
        if (entry.scope === scope) {
            table[id] = entry;
        }
    }
    return table;
}
