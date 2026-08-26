import { describe, expect, it } from "vitest";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { localizationKeyDigest, variableEntryDigest } from "./registries";

function entry(overrides: Partial<VariableRegistryEntry> = {}): VariableRegistryEntry {
    return { id: "v1", name: "Gold", scope: "saved", valueType: "number", storageKey: "v1", ...overrides };
}

describe("the variable registry's fingerprint", () => {
    it("agrees for two copies assembled in different orders", () => {
        // The canonical encoder rather than `JSON.stringify`, for the reason every other digest here
        // uses it: one copy was parsed off disk and one adopted from a message, and key order is not
        // a disagreement anybody can act on.
        const parsed = { id: "v1", name: "Gold", scope: "saved", valueType: "number", storageKey: "v1" } as const;
        const adopted = { storageKey: "v1", valueType: "number", scope: "saved", name: "Gold", id: "v1" } as const;
        expect(variableEntryDigest(parsed)).toBe(variableEntryDigest(adopted));
    });

    it("moves when any field of the entry moves", () => {
        const base = variableEntryDigest(entry());
        expect(variableEntryDigest(entry({ name: "Coins" }))).not.toBe(base);
        expect(variableEntryDigest(entry({ valueType: "string" }))).not.toBe(base);
        expect(variableEntryDigest(entry({ defaultValue: 10 }))).not.toBe(base);
        expect(variableEntryDigest(entry({ description: "spending money" }))).not.toBe(base);
    });

    it("gives an absent entry a value of its own rather than nothing", () => {
        // ⚠ The whole point. Taking a variable back out is an operation like any other, and a machine
        // that failed to apply it has to be caught - answering nothing would rule `unproven` on
        // exactly the effect that proves two copies have parted company.
        expect(variableEntryDigest(null)).toEqual(expect.any(String));
        expect(variableEntryDigest(null)).not.toBe(variableEntryDigest(entry()));
    });
});

describe("a named string's fingerprint", () => {
    it("covers the source text and the note, and nothing about the file", () => {
        const base = localizationKeyDigest({ sourceText: "Start" });
        expect(localizationKeyDigest({ sourceText: "Start" })).toBe(base);
        expect(localizationKeyDigest({ sourceText: "Begin" })).not.toBe(base);
        expect(localizationKeyDigest({ sourceText: "Start", note: "on the title screen" })).not.toBe(base);
    });

    it("gives an absent key a value of its own, so a removal is provable", () => {
        expect(localizationKeyDigest(null)).not.toBe(localizationKeyDigest({ sourceText: "Start" }));
    });
});
