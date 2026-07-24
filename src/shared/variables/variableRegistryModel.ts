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
    type VariableRegistry,
    type VariableRegistryEntry,
} from "../types/variables/registry";

/** The 4-value closed set persistent variables converge to. */
export function normalizePersistentValueType(valueType: string | undefined): StoryVariableValueType {
    return valueType === "boolean" || valueType === "number" || valueType === "string" ? valueType : "json";
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
        valueType: normalizePersistentValueType(v.valueType),
        defaultValue: v.defaultValue as VariableRegistryEntry["defaultValue"],
        storageKey,
    };
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

/** Load-time migration for the registry file. v1 is the first version; newer is refused by the caller. */
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
            valueType: normalizePersistentValueType(typeof value.valueType === "string" ? value.valueType : undefined),
            defaultValue: value.defaultValue as VariableRegistryEntry["defaultValue"],
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

/** Registry entries sorted by name (the order the member tree / variable panel present them in). */
export function listRegistryEntries(registry: VariableRegistry): VariableRegistryEntry[] {
    return Object.values(registry.entries).sort((a, b) => a.name.localeCompare(b.name));
}

/** The runtime table baked into a bundle/pack; keyed by entry id (= the node `persistentVariableId`). */
export function buildPersistentRuntimeTable(registry: VariableRegistry): PersistentVariableRuntimeTable {
    return { ...registry.entries };
}
