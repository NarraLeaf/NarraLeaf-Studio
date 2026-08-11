import { describe, expect, it } from "vitest";
import {
    APP_TAG_ID_RELEASE,
    APP_TAG_SCHEMA_VERSION,
    countAppTagReferences,
    findAppTagByName,
    hasAppTag,
    listAppTags,
    migrateProjectAppTagDocument,
    normalizeProjectAppTags,
    resolveAppTag,
    resolveAppTagIdentity,
    type AppTagBaseIdentity,
    type ProjectAppTag,
} from "./appTag";

/**
 * The model half of build variants: what a stored list is allowed to say, what a tag resolves to,
 * and what a tag reads for a key it does not state.
 */

const BASE: AppTagBaseIdentity = {
    displayName: "My Game",
    identifier: "com.example.mygame",
    version: "1.0.0",
};

const tag = (id: string, overrides: ProjectAppTag["overrides"] = {}): ProjectAppTag => ({
    id,
    name: id,
    overrides,
});

describe("app tag list", () => {
    it("answers the release tag in a project that has never heard of tags", () => {
        expect(listAppTags([])).toEqual([expect.objectContaining({ id: APP_TAG_ID_RELEASE, builtin: true })]);
        expect(hasAppTag([], APP_TAG_ID_RELEASE)).toBe(true);
        expect(resolveAppTag([], undefined).id).toBe(APP_TAG_ID_RELEASE);
    });

    it("resolves an unknown, blank or deleted id to the release tag rather than nothing", () => {
        const stored = [tag("demo")];

        expect(resolveAppTag(stored, "demo").id).toBe("demo");
        expect(resolveAppTag(stored, "gone").id).toBe(APP_TAG_ID_RELEASE);
        expect(resolveAppTag(stored, "   ").id).toBe(APP_TAG_ID_RELEASE);
        expect(resolveAppTag(stored, null).id).toBe(APP_TAG_ID_RELEASE);
    });

    it("refuses a stored release tag, so the synthesized one is the only one", () => {
        const stored = normalizeProjectAppTags([
            { id: APP_TAG_ID_RELEASE, name: "Not the real one" },
            { id: "demo", name: "Demo" },
        ]);

        expect(stored.map(entry => entry.id)).toEqual(["demo"]);
        expect(listAppTags(stored)[0].name).toBe("Release");
    });

    it("keeps the first of two entries under one id", () => {
        const stored = normalizeProjectAppTags([
            { id: "demo", name: "Demo" },
            { id: "demo", name: "Demo again" },
        ]);

        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe("Demo");
    });

    it("drops unknown and blank overrides instead of storing them", () => {
        const stored = normalizeProjectAppTags([
            { id: "demo", name: "Demo", overrides: { displayName: "  ", version: " 1.1.0 ", nonsense: "x" } },
        ]);

        expect(stored[0].overrides).toEqual({ version: "1.1.0" });
    });

    it("reads a document with no tags key as a project with only the release tag", () => {
        const document = migrateProjectAppTagDocument({ schemaVersion: APP_TAG_SCHEMA_VERSION });

        expect(document.tags).toEqual([]);
        expect(listAppTags(document.tags)).toHaveLength(1);
    });

    it("finds a tag by name and reports two of a name rather than picking one", () => {
        const tags = listAppTags([tag("a"), tag("b")]);
        const named = [...tags, { ...tag("c"), name: "a" }];

        expect(findAppTagByName(tags, "A")?.valueOf()).toMatchObject({ id: "a" });
        expect(findAppTagByName(named, "a")).toBe("ambiguous");
        expect(findAppTagByName(tags, "nothing")).toBeNull();
    });
});

describe("app tag inheritance", () => {
    it("reads every key from the project when the tag states nothing", () => {
        const identity = resolveAppTagIdentity(tag("demo"), BASE);

        expect(identity.displayName).toEqual({ value: "My Game", overridden: false });
        expect(identity.identifier).toEqual({ value: "com.example.mygame", overridden: false });
        expect(identity.version).toEqual({ value: "1.0.0", overridden: false });
    });

    it("reads a stated key from the tag and says so", () => {
        const identity = resolveAppTagIdentity(tag("demo", { displayName: "My Game Demo" }), BASE);

        expect(identity.displayName).toEqual({ value: "My Game Demo", overridden: true });
        // Unstated keys are untouched by a stated neighbour.
        expect(identity.version).toEqual({ value: "1.0.0", overridden: false });
    });

    it("follows the project after a key is restored, rather than freezing what was inherited", () => {
        const overridden = tag("demo", { version: "0.9.0-demo" });
        expect(resolveAppTagIdentity(overridden, BASE).version.value).toBe("0.9.0-demo");

        const restored: ProjectAppTag = { ...overridden, overrides: {} };
        const laterBase: AppTagBaseIdentity = { ...BASE, version: "2.0.0" };

        expect(resolveAppTagIdentity(restored, laterBase).version).toEqual({ value: "2.0.0", overridden: false });
    });

    it("gives the release tag the project's own values", () => {
        const identity = resolveAppTagIdentity(listAppTags([])[0], BASE);

        expect(identity.displayName).toEqual({ value: "My Game", overridden: false });
    });
});

describe("app tag references", () => {
    it("counts every stored reference and reports zero for a tag nothing points at", () => {
        const documents = [
            { blocks: [{ payload: { appTagId: "demo" } }, { payload: { appTagId: "demo" } }] },
            { nodes: { a: { params: { appTagId: "bonus" } } } },
        ];

        expect(countAppTagReferences(documents, ["demo", "bonus", "unused"]))
            .toEqual({ demo: 2, bonus: 1, unused: 0 });
    });

    it("ignores a value that names no known tag", () => {
        const documents = [{ payload: { appTagId: "deleted-long-ago" } }];

        expect(countAppTagReferences(documents, ["demo"])).toEqual({ demo: 0 });
    });

    it("does not hang on a document holding a shared sub-object", () => {
        const shared: Record<string, unknown> = { appTagId: "demo" };
        const cyclic: Record<string, unknown> = { shared };
        cyclic.self = cyclic;

        expect(countAppTagReferences([cyclic], ["demo"])).toEqual({ demo: 1 });
    });
});
