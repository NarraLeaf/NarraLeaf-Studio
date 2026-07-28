import { describe, expect, it } from "vitest";
import {
    ABI_DIVERGENCES,
    LORE_ALIASES,
    LORE_CALLBACK_CONFIG,
    LORE_CALLBACK_PROTOTYPE,
    LORE_EVENT_TAGS,
    LORE_STRUCTS,
    LORE_STRUCT_ALIASES,
    LORE_VERBS,
} from "./definitions";
import upstream from "./upstream.json";

/**
 * Holds Studio's hand-written Lore ABI to the header it claims to describe.
 *
 * `upstream.json` is extracted by `tools/lore-abi-extract.mjs` from the SDK's
 * generated bindings, which are themselves generated from `lore-capi/lore.h`. So
 * this is not "our types agree with our types" - it is a field-by-field comparison
 * against the only machine-readable form of the header available.
 *
 * It matters because a wrong field type here is not a type error. koffi will
 * happily read a `uint64_t` where the struct has a `uint32_t` and hand back a
 * number assembled from the neighbouring field. Every value after it is garbage,
 * and nothing throws.
 *
 * When a Lore upgrade breaks this suite: re-run the extractor, read the diff on
 * `upstream.json`, and update `definitions.ts` to match. The diff IS the upgrade
 * report. Do not silence a failure by adding to ABI_DIVERGENCES unless the
 * divergence is deliberate and the reason is written down.
 */

const upstreamStructs = upstream.structs as Record<string, Record<string, string>>;
const upstreamAliases = upstream.aliases as Record<string, string>;
const upstreamFunctions = upstream.functions as Record<string, { returns: string; args: string[] }>;
const upstreamPrototypes = upstream.prototypes as Record<string, { returns: string; args: string[] }>;
const upstreamEnums = upstream.enums as Record<string, Record<string, number>>;

describe("Lore ABI", () => {
    it("is transcribed from a known SDK version", () => {
        // Pinned deliberately: docs/version-control.md §8. A caret range on a 0.x
        // dependency whose bindings are generated from a C header is how you get a
        // silent layout change in a patch release.
        expect(upstream.sdkVersion).toBe("0.8.5");
    });

    describe.each(Object.entries(LORE_STRUCTS))("struct %s", (name, fields) => {
        it("exists upstream", () => {
            expect(upstreamStructs[name], `${name} is not in the extracted header`).toBeDefined();
        });

        it("matches the header field for field, in order", () => {
            if (ABI_DIVERGENCES[name]) return;
            const theirs = upstreamStructs[name];
            // Order is asserted, not just membership: koffi lays a struct out in
            // declaration order, so two structs with the same fields in a different
            // order are two different memory layouts.
            expect(Object.entries(fields)).toEqual(Object.entries(theirs));
        });
    });

    it("declares every alias the header does, with the same target", () => {
        for (const [name, target] of Object.entries({ ...LORE_ALIASES, ...LORE_STRUCT_ALIASES })) {
            expect(upstreamAliases[name], `alias ${name}`).toBe(target);
        }
    });

    it("binds only verbs the header declares, with the expected signature", () => {
        for (const [verb, { symbol, args }] of Object.entries(LORE_VERBS)) {
            const signature = upstreamFunctions[symbol];
            expect(signature, `${verb} -> ${symbol}`).toBeDefined();
            // Every Lore verb is (globals*, args*, callbackConfig) -> int32_t. If one
            // ever is not, the shared `invoke` path cannot call it and the wrapper
            // needs its own handling rather than a table entry.
            expect(signature.returns, symbol).toBe("int32_t");
            expect(signature.args, symbol).toEqual(["LoreGlobalArgs*", `${args}*`, "LoreEventCallbackConfig"]);
        }
    });

    it("describes the event callback the way the header does", () => {
        expect(upstreamPrototypes[LORE_CALLBACK_PROTOTYPE.name]).toEqual({
            returns: LORE_CALLBACK_PROTOTYPE.returns,
            args: [...LORE_CALLBACK_PROTOTYPE.args],
        });
        expect(upstreamStructs.LoreEventCallbackConfig).toEqual(LORE_CALLBACK_CONFIG);
    });

    it("uses the header's event tag values", () => {
        for (const [name, value] of Object.entries(LORE_EVENT_TAGS)) {
            expect(upstreamEnums.LoreEventTag[name], `tag ${name}`).toBe(value);
        }
    });

    it("declares every struct its own fields reference", () => {
        // koffi resolves a type name when the struct is declared, so a reference to
        // something we never register fails at load with an opaque message. Catching
        // it here names the field instead.
        const known = new Set([
            ...Object.keys(LORE_STRUCTS),
            ...Object.keys(LORE_ALIASES),
            ...Object.keys(LORE_STRUCT_ALIASES),
            "int", "int32_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "uintptr_t",
        ]);
        for (const [structName, fields] of Object.entries(LORE_STRUCTS)) {
            for (const [field, type] of Object.entries(fields)) {
                const base = type.replace(/\*$/, "").replace(/\[\d+\]$/, "");
                expect(known.has(base), `${structName}.${field} references unknown type ${base}`).toBe(true);
            }
        }
    });

    it("declares structs after everything they reference", () => {
        // Declaration order is load-bearing for koffi, and the failure is a runtime
        // "unknown type" from deep inside registration.
        const declared = new Set<string>([
            ...Object.keys(LORE_ALIASES),
            "int", "int32_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "uintptr_t",
        ]);
        const structAliasTargets = new Map(Object.entries(LORE_STRUCT_ALIASES));
        for (const [structName, fields] of Object.entries(LORE_STRUCTS)) {
            for (const [field, type] of Object.entries(fields)) {
                const base = type.replace(/\*$/, "").replace(/\[\d+\]$/, "");
                const resolved = structAliasTargets.get(base) ?? base;
                expect(
                    declared.has(resolved) || resolved === structName,
                    `${structName}.${field} references ${base} before it is declared`,
                ).toBe(true);
            }
            declared.add(structName);
        }
    });
});
