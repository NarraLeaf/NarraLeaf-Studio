import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument } from "@shared/types/story";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { declaredSavedDefaults } from "@shared/variables/mergedPersistentView";
import { variableRegistrySpec } from "@shared/documents/specs/variables";
import { buildSavedRuntimeTable } from "@shared/variables/variableRegistryModel";
import { copyDeclaredSavedDefaults, readSavedVariableForScreen, type SavedVariableStorable } from "./savedVariableReads";

/**
 * `Get Saved Var` on a screen with no playthrough behind it - the title screen, before any story has
 * been started or compiled. It reports `found: false` and, since "not written yet reads the default",
 * the default the build declares rather than null.
 */

const AFFECTION_ID = "3b1f6c2e-8d4a-4f0b-9c7e-5a2d1e0f9b8c";
const ROUTE_ROW_ID = "9e4d2c1b-7a6f-4e5d-8c3b-2a1f0e9d8c7b";

function registryEntry(id: string, name: string, defaultValue: VariableRegistryEntry["defaultValue"]): VariableRegistryEntry {
    return { id, name, storageKey: `saved:${name}`, valueType: typeof defaultValue === "number" ? "number" : "string", defaultValue } as VariableRegistryEntry;
}

/** A story that still declares one saved variable the old way, as a `/save` row. */
function storyWithSaveRow(): StoryDocument {
    const row: StoryBlock = {
        id: ROUTE_ROW_ID,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: { scope: "saved", name: "route", valueType: "string", defaultValue: "common", storageKey: "route" },
    } as unknown as StoryBlock;
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [{ id: "c1", name: "Chapter", sceneIds: ["s1"] }],
        scenes: { s1: { id: "s1", name: "Opening", runtimeName: "opening", rootBlockIds: [ROUTE_ROW_ID], blocks: { [ROUTE_ROW_ID]: row } } },
    };
}

const bundle = {
    ui: { savedVariables: { [AFFECTION_ID]: registryEntry(AFFECTION_ID, "affection", 7) } },
    storyLibrary: { documents: { "story-1": storyWithSaveRow() } },
};

function storableHolding(values: Record<string, unknown>): SavedVariableStorable {
    return {
        hasNamespace: () => true,
        getNamespace: () => ({ has: key => key in values, get: key => values[key] }),
    };
}

describe("declaredSavedDefaults", () => {
    it("reads the registry and every story's /save rows, by the id a node names", () => {
        expect(declaredSavedDefaults(bundle)).toEqual({ [AFFECTION_ID]: 7, [ROUTE_ROW_ID]: "common" });
    });
});

describe("readSavedVariableForScreen", () => {
    const defaults = copyDeclaredSavedDefaults(declaredSavedDefaults(bundle));

    it("carries a special id from a project document to a title screen default", () => {
        const data = JSON.parse(`{"schemaVersion":2,"entries":{"__proto__":{"name":"Progress","scope":"saved","valueType":"number","storageKey":"progress","defaultValue":7}}}`);
        const registry = variableRegistrySpec.parse(data, { path: "editor/variables.json" } as Parameters<typeof variableRegistrySpec.parse>[1]);
        const saved = buildSavedRuntimeTable(registry);
        const declaredDefaults = copyDeclaredSavedDefaults(declaredSavedDefaults({ ui: { savedVariables: saved } }));
        expect(readSavedVariableForScreen({
            variableId: "__proto__", compiled: null, storable: null, declaredDefaults,
        })).toEqual({ value: 7, found: false });
    });

    it("copies and reads a declared special id without sharing object defaults", () => {
        const objectDefault = { route: ["north"] };
        const declared = Object.fromEntries([["__proto__", objectDefault]]);
        const copies = copyDeclaredSavedDefaults(declared);
        expect(Object.keys(copies)).toEqual(["__proto__"]);
        const first = readSavedVariableForScreen({ variableId: "__proto__", compiled: null, storable: null, declaredDefaults: copies });
        const second = readSavedVariableForScreen({ variableId: "__proto__", compiled: null, storable: null, declaredDefaults: copies });
        expect(first).toEqual({ value: objectDefault, found: false });
        expect(first.value).toBe(second.value);
        expect(first.value).not.toBe(objectDefault);
    });

    it.each(["__proto__", "constructor", "toString"])("treats undeclared inherited id %s as missing", variableId => {
        const compiled = { savedNamespaceName: "__saved__", savedVariables: {} };
        expect(readSavedVariableForScreen({
            variableId,
            compiled,
            storable: () => storableHolding({}),
            declaredDefaults: {},
        })).toEqual({ value: null, found: false });
    });

    it("reads a declared special id in an active playthrough", () => {
        const compiled = {
            savedNamespaceName: "__saved__",
            savedVariables: Object.fromEntries([["__proto__", { storageKey: "progress", defaultValue: 7 }]]),
        };
        expect(readSavedVariableForScreen({
            variableId: "__proto__", compiled, storable: () => storableHolding({ progress: 12 }), declaredDefaults: {},
        })).toEqual({ value: 12, found: true });
    });

    it("answers the declared default, not found, on a screen with no game and no compile", () => {
        expect(readSavedVariableForScreen({ variableId: AFFECTION_ID, compiled: null, storable: null, declaredDefaults: defaults }))
            .toEqual({ value: 7, found: false });
        // A variable declared only by a story row is known before that story compiles, too.
        expect(readSavedVariableForScreen({ variableId: ROUTE_ROW_ID, compiled: null, storable: null, declaredDefaults: defaults }))
            .toEqual({ value: "common", found: false });
    });

    it("answers null for an id nothing declares", () => {
        expect(readSavedVariableForScreen({ variableId: "gone", compiled: null, storable: null, declaredDefaults: defaults }))
            .toEqual({ value: null, found: false });
    });

    it("reads the playthrough once there is one: the stored value, or the default until written", () => {
        const compiled = {
            savedNamespaceName: "__saved__",
            savedVariables: { [AFFECTION_ID]: { storageKey: "saved:affection", defaultValue: 7 } },
        };
        expect(readSavedVariableForScreen({
            variableId: AFFECTION_ID,
            compiled,
            storable: () => storableHolding({ "saved:affection": 0 }),
            declaredDefaults: defaults,
        })).toEqual({ value: 0, found: true });
        expect(readSavedVariableForScreen({
            variableId: AFFECTION_ID,
            compiled,
            storable: () => storableHolding({}),
            declaredDefaults: defaults,
        })).toEqual({ value: 7, found: true });
    });

    it("answers a variable the running story does not declare with its build default, not found", () => {
        const compiled = { savedNamespaceName: "__saved__", savedVariables: {} };
        expect(readSavedVariableForScreen({
            variableId: ROUTE_ROW_ID,
            compiled,
            storable: () => storableHolding({}),
            declaredDefaults: defaults,
        })).toEqual({ value: "common", found: false });
    });

    it("hands out a copy of an object default, the same one every read", () => {
        const declared = { [AFFECTION_ID]: { met: ["Alice"] } };
        const copies = copyDeclaredSavedDefaults(declared);
        const first = readSavedVariableForScreen({ variableId: AFFECTION_ID, compiled: null, storable: null, declaredDefaults: copies });
        const second = readSavedVariableForScreen({ variableId: AFFECTION_ID, compiled: null, storable: null, declaredDefaults: copies });
        expect(first.value).toEqual({ met: ["Alice"] });
        expect(first.value).toBe(second.value);
        expect(first.value).not.toBe(declared[AFFECTION_ID]);
    });
});
