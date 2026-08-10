import {beforeEach, describe, expect, it} from "vitest";
import {
    DocumentStorage,
    loadDocument,
    saveDocument,
} from "@shared/documents/documentIo";
import {
    PROJECT_DOCUMENT_SPECS,
    localizationDocumentSpec,
    localizationKeysSpec,
    variableRegistrySpec,
    voiceDocumentSpec,
} from "@shared/documents/specs";
import {resolveDocumentSpecForPath} from "@shared/documents/registry";
import {DocumentSpec} from "@shared/documents/types";
import {LocalizationDocument, LocalizationKeysDocument} from "@shared/types/localization";
import {VoiceDocument} from "@shared/types/voice";
import {VARIABLE_REGISTRY_SCHEMA_VERSION, VariableRegistry} from "@shared/types/variables/registry";

class MemoryStorage implements DocumentStorage {
    public readonly files = new Map<string, string>();
    public readonly writes: string[] = [];

    public read(path: string): Promise<string | null> {
        return Promise.resolve(this.files.get(path) ?? null);
    }

    public write(path: string, text: string): Promise<void> {
        this.writes.push(path);
        this.files.set(path, text);
        return Promise.resolve();
    }

    public copy(fromPath: string, toPath: string): Promise<void> {
        const value = this.files.get(fromPath);
        if (value === undefined) {
            return Promise.reject(new Error(`no such file: ${fromPath}`));
        }
        this.files.set(toPath, value);
        return Promise.resolve();
    }
}

let storage: MemoryStorage;

beforeEach(() => {
    storage = new MemoryStorage();
});

/** Save, read back, and insist the bytes were already canonical the first time. */
async function expectRoundTrip<T>(spec: DocumentSpec<T>, path: string, document: T): Promise<void> {
    await saveDocument(spec, storage, path, document);
    const result = await loadDocument(spec, storage, path);

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
        return;
    }
    // `toStrictEqual`, not `toEqual`: the whole point of these cases is the difference between a
    // key that is absent and a key holding `undefined`, and `toEqual` calls those two the same.
    expect(result.document).toStrictEqual(document);
    expect(result.normalized).toBe(true);
}

async function loadText<T>(spec: DocumentSpec<T>, path: string, text: string) {
    storage.files.set(path, text);
    return loadDocument(spec, storage, path, {now: () => new Date("2026-07-27T00:00:00.000Z")});
}

describe("document specs: registration", () => {
    it("resolves each document's path back to its own spec", () => {
        expect(resolveDocumentSpecForPath("editor/variables.json")?.spec).toBe(variableRegistrySpec);
        expect(resolveDocumentSpecForPath("editor/voice/ja.json")).toEqual({
            spec: voiceDocumentSpec,
            parameters: {locale: "ja"},
        });
        expect(resolveDocumentSpecForPath("editor/localization/zh-CN.json")).toEqual({
            spec: localizationDocumentSpec,
            parameters: {locale: "zh-CN"},
        });
    });

    /**
     * `keys.json` is a legal locale code, so it sits inside the translation document's pattern
     * space. Registration accepts the pair because the literal is strictly more specific, and this
     * is the assertion that the resolution actually goes that way - resolved the other way, the
     * named-key registry would be parsed as an empty translation library.
     */
    it("gives editor/localization/keys.json to the keys spec, not to the per-locale spec", () => {
        expect(resolveDocumentSpecForPath("editor/localization/keys.json")).toEqual({
            spec: localizationKeysSpec,
            parameters: {},
        });
    });

    it("leaves paths that are not documents unclaimed", () => {
        expect(resolveDocumentSpecForPath("assets/content/ab/cd/ef")).toBeUndefined();
        expect(resolveDocumentSpecForPath("editor/localization")).toBeUndefined();
    });

    it("builds the same paths it matches", () => {
        expect(variableRegistrySpec.pathFor()).toBe("editor/variables.json");
        expect(voiceDocumentSpec.pathFor({locale: "en-US"})).toBe("editor/voice/en-US.json");
        expect(localizationDocumentSpec.pathFor({locale: "ja"})).toBe("editor/localization/ja.json");
        expect(localizationKeysSpec.pathFor()).toBe("editor/localization/keys.json");
        for (const spec of PROJECT_DOCUMENT_SPECS) {
            for (const path of spec.paths) {
                expect(spec.matches(path.replace("<locale>", "de"))).toBe(true);
            }
        }
    });
});

/**
 * The landmine this milestone was warned about: `JSON.stringify` dropped `undefined` properties in
 * silence, the canonical encoder throws on them. Every optional field of these three formats is
 * exercised absent and present, and the assigned-`undefined` spelling is asserted to fail, because
 * a document that carries one is a document that cannot be saved at all.
 */
describe("document specs: optional fields survive a round trip", () => {
    const VARIABLES = "editor/variables.json";
    const VOICE = "editor/voice/ja.json";
    const LOCALIZATION = "editor/localization/ja.json";
    const KEYS = "editor/localization/keys.json";

    it("round-trips a variable registry with every optional field absent", async () => {
        const document: VariableRegistry = {
            schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
            entries: {
                gold: {id: "gold", name: "Gold", scope: "persistent", valueType: "number", storageKey: "gold"},
            },
        };

        await expectRoundTrip(variableRegistrySpec, VARIABLES, document);
    });

    it("round-trips a variable registry with every optional field present", async () => {
        const document: VariableRegistry = {
            schemaVersion: VARIABLE_REGISTRY_SCHEMA_VERSION,
            entries: {
                gold: {
                    id: "gold",
                    name: "Gold",
                    scope: "saved",
                    valueType: "number",
                    defaultValue: 0,
                    storageKey: "gold",
                    description: "coins in the purse",
                },
            },
            meta: {createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z"},
        };

        await expectRoundTrip(variableRegistrySpec, VARIABLES, document);
    });

    it("refuses to write a registry whose cleared default was assigned rather than deleted", async () => {
        const cleared = {
            schemaVersion: 1,
            entries: {
                gold: {id: "gold", name: "Gold", valueType: "number", storageKey: "gold", defaultValue: undefined},
            },
        } as unknown as VariableRegistry;

        await expect(saveDocument(variableRegistrySpec, storage, VARIABLES, cleared))
            .rejects.toThrow(/undefined/);
        expect(storage.writes).toEqual([]);
    });

    it("never produces one itself, whatever the file left out", async () => {
        const result = await loadText(variableRegistrySpec, VARIABLES, JSON.stringify({
            schemaVersion: 1,
            entries: {gold: {id: "gold", name: "Gold", valueType: "number", storageKey: "gold"}},
        }));

        expect(result.status).toBe("loaded");
        if (result.status !== "loaded") {
            return;
        }
        expect("defaultValue" in result.document.entries.gold).toBe(false);
        // Saving what parse produced is the step that used to throw on a default-less variable.
        await expect(saveDocument(variableRegistrySpec, storage, VARIABLES, result.document)).resolves.toBeUndefined();
    });

    it("round-trips a voice library with and without its optional unit fields", async () => {
        const bare: VoiceDocument = {
            schemaVersion: 1,
            locale: "ja",
            units: {"text-1": {assetId: "asset-1", sourceHash: "h1", status: "linked"}},
        };
        const full: VoiceDocument = {
            schemaVersion: 1,
            locale: "ja",
            units: {
                "text-1": {assetId: "asset-1", sourceHash: "h1", status: "approved", duration: 2.5, note: "softer"},
            },
        };

        await expectRoundTrip(voiceDocumentSpec, VOICE, bare);
        await expectRoundTrip(voiceDocumentSpec, VOICE, full);
    });

    it("round-trips a translation library with and without its optional unit fields", async () => {
        const bare: LocalizationDocument = {
            schemaVersion: 1,
            locale: "ja",
            units: {"text-1": {target: "こんにちは", sourceHash: "h1", status: "translated"}},
        };
        const full: LocalizationDocument = {
            schemaVersion: 1,
            locale: "ja",
            units: {"text-1": {target: "こんにちは", sourceHash: "h1", status: "reviewed", note: "greeting"}},
        };

        await expectRoundTrip(localizationDocumentSpec, LOCALIZATION, bare);
        await expectRoundTrip(localizationDocumentSpec, LOCALIZATION, full);
    });

    it("round-trips a key registry with and without notes", async () => {
        const bare: LocalizationKeysDocument = {schemaVersion: 1, keys: {"menu.start": {sourceText: "Start"}}};
        const full: LocalizationKeysDocument = {
            schemaVersion: 1,
            keys: {"menu.start": {sourceText: "Start", note: "main menu"}},
        };

        await expectRoundTrip(localizationKeysSpec, KEYS, bare);
        await expectRoundTrip(localizationKeysSpec, KEYS, full);
    });

    it("writes keys in code-unit order regardless of the order they were built in", async () => {
        await saveDocument(localizationKeysSpec, storage, KEYS, {
            schemaVersion: 1,
            keys: {zulu: {sourceText: "Z"}, alpha: {sourceText: "A"}},
        });

        expect(storage.files.get(KEYS)).toBe([
            "{",
            "  \"keys\": {",
            "    \"alpha\": {",
            "      \"sourceText\": \"A\"",
            "    },",
            "    \"zulu\": {",
            "      \"sourceText\": \"Z\"",
            "    }",
            "  },",
            "  \"schemaVersion\": 1",
            "}",
            "",
        ].join("\n"));
    });
});

describe("document specs: what counts as unreadable", () => {
    const VOICE = "editor/voice/ja.json";

    it("takes the locale from the path, not from the document", async () => {
        const result = await loadText(voiceDocumentSpec, VOICE, JSON.stringify({schemaVersion: 1, locale: "de", units: {}}));

        expect(result.status === "loaded" && result.document.locale).toBe("ja");
    });

    it("rejects a root that is not an object", async () => {
        for (const text of ["[]", "\"a string\"", "42", "null"]) {
            const result = await loadText(voiceDocumentSpec, VOICE, text);

            expect(result.status, text).toBe("corrupt");
            expect(result.status === "corrupt" && result.error.reason, text).toContain("at the document root");
        }
    });

    /**
     * The normalizers return an *empty* document for these, and an empty document is what the next
     * autosave would write over the file. Corrupt is the only answer that leaves the bytes alone.
     */
    it("rejects a unit map that is not a map", async () => {
        for (const units of ["null", "[]", "\"nope\"", "7"]) {
            const result = await loadText(voiceDocumentSpec, VOICE, `{"schemaVersion": 1, "units": ${units}}`);

            expect(result.status, units).toBe("corrupt");
            expect(result.status === "corrupt" && result.error.reason, units).toContain("\"units\"");
        }
    });

    it("rejects a document a newer Studio wrote, instead of silently downgrading it", async () => {
        const result = await loadText(voiceDocumentSpec, VOICE, JSON.stringify({
            schemaVersion: 99,
            units: {"text-1": {assetId: "a", sourceHash: "h", status: "linked", takeCount: 3}},
        }));

        expect(result.status).toBe("corrupt");
        expect(result.status === "corrupt" && result.error.reason).toContain("newer version of Studio");
        // Quarantined and left in place - the fields this build has never heard of are still there.
        expect(result.status === "corrupt" && result.quarantinePath).not.toBeNull();
        expect(storage.files.get(VOICE)).toContain("takeCount");
        expect(storage.writes).toEqual([]);
    });

    it("accepts an older document and reports it as needing a rewrite", async () => {
        // No schemaVersion at all, and units keyed the way the first release wrote them.
        const result = await loadText(voiceDocumentSpec, VOICE, JSON.stringify({
            units: {"text-1": {assetId: "a", sourceHash: "h", status: "linked"}},
        }));

        expect(result.status).toBe("loaded");
        expect(result.status === "loaded" && result.document.schemaVersion).toBe(1);
        expect(result.status === "loaded" && result.normalized).toBe(false);
    });

    it("rejects a registry whose entries are not a map", async () => {
        const result = await loadText(variableRegistrySpec, "editor/variables.json", "{\"entries\": []}");

        expect(result.status).toBe("corrupt");
    });

    it("reports the kind that failed, so the message can name the document", async () => {
        const result = await loadText(localizationKeysSpec, "editor/localization/keys.json", "{oops");

        expect(result.status === "corrupt" && result.error.kind).toBe("localization-keys");
    });
});
