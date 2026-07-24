import { describe, expect, it } from "vitest";
import type { StorySavedVariableDefinition } from "../types/story/document";
import type { VariableRegistryEntry } from "../types/variables/registry";
import { buildMergedPersistentView, mergedPersistentStorageKeys } from "./mergedPersistentView";

function registryEntry(id: string, name: string, storageKey = id): VariableRegistryEntry {
    return { id, name, valueType: "number", storageKey, defaultValue: 0 };
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
