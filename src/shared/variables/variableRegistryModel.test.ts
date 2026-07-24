import { describe, expect, it } from "vitest";
import type { BlueprintPersistentVariable } from "../types/blueprint/document";
import { VARIABLE_REGISTRY_SCHEMA_VERSION } from "../types/variables/registry";
import {
    buildPersistentRuntimeTable,
    createEmptyVariableRegistry,
    listRegistryEntries,
    migrateVariableRegistryToLatest,
    normalizePersistentValueType,
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

    it("throws on a non-object", () => {
        expect(() => migrateVariableRegistryToLatest(null)).toThrow();
    });
});

describe("listRegistryEntries / buildPersistentRuntimeTable", () => {
    it("lists entries by name and projects a runtime table keyed by id", () => {
        const registry = createEmptyVariableRegistry();
        registry.entries = {
            b: { id: "b", name: "Beta", valueType: "string", storageKey: "b" },
            a: { id: "a", name: "Alpha", valueType: "number", defaultValue: 1, storageKey: "a" },
        };
        expect(listRegistryEntries(registry).map(e => e.name)).toEqual(["Alpha", "Beta"]);
        const table = buildPersistentRuntimeTable(registry);
        expect(table.a.storageKey).toBe("a");
        expect(table.a.defaultValue).toBe(1);
    });
});
