import { describe, expect, it } from "vitest";
import type { BlueprintPersistentVariable } from "../types/blueprint/document";
import { VARIABLE_REGISTRY_SCHEMA_VERSION } from "../types/variables/registry";
import {
    buildPersistentRuntimeTable,
    buildSavedRuntimeTable,
    createEmptyVariableRegistry,
    listRegistryEntries,
    migrateVariableRegistryToLatest,
    normalizePersistentValueType,
    normalizeVariableRegistryScope,
    registryEntryFromBlueprintPersistent,
    seedRegistryEntriesFromBlueprintPersistent,
} from "./variableRegistryModel";

describe("normalizePersistentValueType", () => {
    it("keeps the three story primitives", () => {
        expect(normalizePersistentValueType("boolean")).toBe("boolean");
        expect(normalizePersistentValueType("number")).toBe("number");
        expect(normalizePersistentValueType("string")).toBe("string");
    });

    it("collapses json, unknown, and undefined to json", () => {
        expect(normalizePersistentValueType("json")).toBe("json");
        expect(normalizePersistentValueType("SomePluginType")).toBe("json");
        expect(normalizePersistentValueType(undefined)).toBe("json");
    });
});

describe("registryEntryFromBlueprintPersistent", () => {
    it("takes id from storageKey so story refs (which address by storageKey) resolve unchanged", () => {
        const v: BlueprintPersistentVariable = {
            id: "bp_id_1",
            name: "Gold",
            valueType: "number",
            defaultValue: 100,
            storageKey: "storage_gold",
        };
        const entry = registryEntryFromBlueprintPersistent(v);
        expect(entry).toEqual({
            id: "storage_gold",
            name: "Gold",
            scope: "persistent",
            valueType: "number",
            defaultValue: 100,
            storageKey: "storage_gold",
        });
    });

    it("falls back to id when storageKey is blank, and normalizes a free-form valueType", () => {
        const v = {
            id: "bp_id_2",
            name: "Inventory",
            valueType: "PluginBag",
            storageKey: "  ",
        } as unknown as BlueprintPersistentVariable;
        const entry = registryEntryFromBlueprintPersistent(v);
        expect(entry.id).toBe("bp_id_2");
        expect(entry.storageKey).toBe("bp_id_2");
        expect(entry.valueType).toBe("json");
    });
});

describe("seedRegistryEntriesFromBlueprintPersistent", () => {
    it("keys entries by storageKey-derived id and reports the node-param remap for divergent ids", () => {
        const persistentVariables: Record<string, BlueprintPersistentVariable> = {
            same: { id: "same", name: "A", valueType: "string", storageKey: "same" },
            divergent: { id: "divergent", name: "B", valueType: "boolean", storageKey: "key_b" },
        };
        const { entries, idRemap } = seedRegistryEntriesFromBlueprintPersistent(persistentVariables);
        expect(Object.keys(entries).sort()).toEqual(["key_b", "same"]);
        expect(entries.same.storageKey).toBe("same");
        expect(entries.key_b.name).toBe("B");
        // Only the divergent one needs a node-param rewrite (old map key -> new id).
        expect(idRemap).toEqual({ divergent: "key_b" });
    });

    it("skips malformed entries and tolerates undefined", () => {
        const { entries, idRemap } = seedRegistryEntriesFromBlueprintPersistent({
            good: { id: "good", name: "Good", valueType: "number", storageKey: "good" },
            broken: { name: "no id or key" } as unknown as BlueprintPersistentVariable,
        });
        expect(Object.keys(entries)).toEqual(["good"]);
        expect(idRemap).toEqual({});
        expect(seedRegistryEntriesFromBlueprintPersistent(undefined).entries).toEqual({});
    });
});

describe("normalizeVariableRegistryScope", () => {
    it("keeps the two project scopes and reads anything else as persistent", () => {
        expect(normalizeVariableRegistryScope("saved")).toBe("saved");
        expect(normalizeVariableRegistryScope("persistent")).toBe("persistent");
        expect(normalizeVariableRegistryScope("scene")).toBe("persistent");
        expect(normalizeVariableRegistryScope(undefined)).toBe("persistent");
    });
});

describe("migrateVariableRegistryToLatest", () => {
    it("normalizes entries and stamps the current schema version", () => {
        const migrated = migrateVariableRegistryToLatest({
            schemaVersion: 1,
            entries: {
                gold: { id: "gold", name: "Gold", valueType: "number", defaultValue: 5, storageKey: "gold", description: "coins" },
                weird: { id: "weird", name: "Weird", valueType: "PluginThing", storageKey: "weird" },
                junk: { id: "junk" },
            },
        });
        expect(migrated.schemaVersion).toBe(VARIABLE_REGISTRY_SCHEMA_VERSION);
        expect(migrated.entries.gold.description).toBe("coins");
        expect(migrated.entries.weird.valueType).toBe("json");
        // Entries without a usable storageKey/name are dropped, not carried forward malformed.
        expect(migrated.entries.junk).toBeUndefined();
    });

    /**
     * The migration re-derives every field, so a field it forgets to read is a field stripped on
     * load. Both halves are asserted: a v1 entry has no scope and must land as persistent (the only
     * kind v1 could hold), and a v2 entry's scope must survive the same pass unchanged.
     */
    it("defaults a pre-v2 entry to persistent and preserves an explicit scope", () => {
        const migrated = migrateVariableRegistryToLatest({
            schemaVersion: 1,
            entries: {
                legacy: { id: "legacy", name: "Legacy", valueType: "number", storageKey: "legacy" },
                saved: { id: "saved", name: "Saved", scope: "saved", valueType: "number", storageKey: "saved" },
                bogus: { id: "bogus", name: "Bogus", scope: "scene", valueType: "number", storageKey: "bogus" },
            },
        });
        expect(migrated.entries.legacy.scope).toBe("persistent");
        expect(migrated.entries.saved.scope).toBe("saved");
        expect(migrated.entries.bogus.scope).toBe("persistent");
    });

    it("throws on a non-object", () => {
        expect(() => migrateVariableRegistryToLatest(null)).toThrow();
    });
});

describe("listRegistryEntries / runtime tables", () => {
    function seeded() {
        const registry = createEmptyVariableRegistry();
        registry.entries = {
            b: { id: "b", name: "Beta", scope: "persistent", valueType: "string", storageKey: "b" },
            a: { id: "a", name: "Alpha", scope: "persistent", valueType: "number", defaultValue: 1, storageKey: "a" },
            s: { id: "s", name: "Aardvark", scope: "saved", valueType: "boolean", storageKey: "s" },
        };
        return registry;
    }

    it("lists entries by name, and by name within a scope", () => {
        const registry = seeded();
        expect(listRegistryEntries(registry).map(e => e.name)).toEqual(["Aardvark", "Alpha", "Beta"]);
        expect(listRegistryEntries(registry, "persistent").map(e => e.name)).toEqual(["Alpha", "Beta"]);
        expect(listRegistryEntries(registry, "saved").map(e => e.name)).toEqual(["Aardvark"]);
    });

    /**
     * The two tables feed different stores - app-level persistence and the save file - so an entry
     * appearing in the wrong one would write player state into the wrong lifetime.
     */
    it("projects one runtime table per scope, keyed by id", () => {
        const registry = seeded();
        const persistent = buildPersistentRuntimeTable(registry);
        expect(Object.keys(persistent).sort()).toEqual(["a", "b"]);
        expect(persistent.a.storageKey).toBe("a");
        expect(persistent.a.defaultValue).toBe(1);

        const saved = buildSavedRuntimeTable(registry);
        expect(Object.keys(saved)).toEqual(["s"]);
    });
});
