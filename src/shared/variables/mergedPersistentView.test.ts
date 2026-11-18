import { describe, expect, it } from "vitest";
import { ScopeStoreBridge } from "../../renderer/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import type { StorySavedVariableDefinition } from "../types/story/document";
import type { VariableRegistryEntry } from "../types/variables/registry";
import {
    buildMergedPersistentView,
    buildMergedVariableView,
    declaredPersistentDefaults,
    declaredSavedDefaults,
    mergedPersistentStorageKeys,
    persistentDefaultsByStorageKey,
} from "./mergedPersistentView";

function registryEntry(
    id: string,
    name: string,
    storageKey = id,
    scope: VariableRegistryEntry["scope"] = "persistent",
): VariableRegistryEntry {
    return { id, name, scope, valueType: "number", storageKey, defaultValue: 0 };
}
function storyDef(id: string, name: string, storageKey = id): StorySavedVariableDefinition {
    return { id, name, valueType: "string", storageKey };
}

describe("buildMergedPersistentView", () => {
    it("unions both surfaces, tagging each entry's source", () => {
        const view = buildMergedPersistentView([registryEntry("gold", "Gold")], [storyDef("hp", "HP")]);
        expect(view.entries.map(e => [e.name, e.source, e.storageKey])).toEqual([
            ["Gold", "registry", "gold"],
            ["HP", "story", "hp"],
        ]);
        expect(view.nameCollisions).toEqual([]);
        expect([...mergedPersistentStorageKeys(view)].sort()).toEqual(["gold", "hp"]);
    });

    it("flags a display name declared in both surfaces as a collision", () => {
        const view = buildMergedPersistentView(
            [registryEntry("bp_score", "Score", "bp_score")],
            [storyDef("story_score", "Score", "story_score")],
        );
        expect(view.nameCollisions).toEqual([{ name: "Score", storageKeys: ["bp_score", "story_score"] }]);
    });

    it("does not flag same-source name repeats as cross-surface collisions", () => {
        const view = buildMergedPersistentView(
            [registryEntry("a", "Dup", "a"), registryEntry("b", "Dup", "b")],
            [],
        );
        expect(view.nameCollisions).toEqual([]);
    });

    it("is empty for empty inputs", () => {
        const view = buildMergedPersistentView([], []);
        expect(view.entries).toEqual([]);
        expect(view.nameCollisions).toEqual([]);
    });
});

describe("buildMergedVariableView", () => {
    it("merges the saved scope the same way, with the same collision rule", () => {
        const view = buildMergedVariableView(
            [registryEntry("reg_flag", "Route Flag", "reg_flag", "saved")],
            [storyDef("row_hp", "HP"), storyDef("row_flag", "Route Flag")],
        );
        expect(view.entries.map(e => [e.name, e.source])).toEqual([
            ["Route Flag", "registry"],
            ["HP", "story"],
            ["Route Flag", "story"],
        ]);
        expect(view.nameCollisions).toEqual([{ name: "Route Flag", storageKeys: ["reg_flag", "row_flag"] }]);
    });

    /**
     * The scope filter is the caller's, not the merge's - so a caller that hands it entries of the
     * wrong scope gets them back. Asserted rather than assumed: it is what makes the two wrappers
     * safe to share one implementation, and what a future "just filter it inside" edit would break.
     */
    it("unions exactly what it is given, without filtering by scope", () => {
        const view = buildMergedVariableView(
            [registryEntry("s", "Saved One", "s", "saved"), registryEntry("p", "Persistent One", "p", "persistent")],
            [],
        );
        expect(view.entries.map(e => e.id)).toEqual(["s", "p"]);
    });

    it("is the implementation buildMergedPersistentView delegates to", () => {
        const registry = [registryEntry("gold", "Gold")];
        const story = [storyDef("hp", "HP")];
        expect(buildMergedPersistentView(registry, story)).toEqual(buildMergedVariableView(registry, story));
    });
});

describe("declared defaults with special keys", () => {
    it("answers a persistent default without writing it to the store", async () => {
        const entry = { ...registryEntry("id", "Progress", "__proto__"), defaultValue: 7 };
        const defaults = declaredPersistentDefaults({ ui: { persistentVariables: { id: entry } } });
        const bridge = new ScopeStoreBridge({ persistentDefaults: defaults });

        expect(Object.prototype.hasOwnProperty.call(defaults, "__proto__")).toBe(true);
        expect(bridge.persistenceGet("__proto__")).toBe(7);
        expect(await bridge.persistenceGetAsync("__proto__")).toBe(7);
        expect(await bridge.persistenceStoredAsync("__proto__")).toBeUndefined();
        expect(bridge.getPersistenceSnapshot().size).toBe(0);
    });

    it("keeps a registry object default ahead of a story default for the same key", () => {
        const entry = { ...registryEntry("id", "Progress", "__proto__"), defaultValue: { chapter: 2 } };
        const story = { ...storyDef("row", "Old Progress", "__proto__"), defaultValue: { chapter: 1 } };
        const defaults = persistentDefaultsByStorageKey(buildMergedPersistentView([entry], [story]));
        const bridge = new ScopeStoreBridge({ persistentDefaults: defaults });

        expect(Object.prototype.hasOwnProperty.call(defaults, "__proto__")).toBe(true);
        expect(bridge.persistenceGet("__proto__")).toEqual({ chapter: 2 });
        expect(Object.getPrototypeOf(defaults)).toBe(Object.prototype);
    });

    it("includes a saved default whose variable id is __proto__", () => {
        const entry = { ...registryEntry("__proto__", "Progress", "saved-key", "saved"), defaultValue: 4 };
        const defaults = declaredSavedDefaults({ ui: { savedVariables: { entry } } });

        expect(Object.prototype.hasOwnProperty.call(defaults, "__proto__")).toBe(true);
        expect(defaults["__proto__"]).toBe(4);
        expect(Object.getPrototypeOf(defaults)).toBe(Object.prototype);
    });
});
