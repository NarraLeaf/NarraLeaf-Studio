import { describe, expect, it } from "vitest";
import type { TempSpeakerRef } from "@/lib/workspace/services/story/storyModel";
import { getSpeakerCandidates } from "./StorySceneEditorRows";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";

function character(id: string, name: string): Character {
    return Character.fromJSON({ profile: CharacterProfile.create(id, name).toJSON() });
}

const alice = character("char-alice", "Alice");
const bob = character("char-bob", "Bob");

function temps(...names: string[]): TempSpeakerRef[] {
    return names.map(name => ({ name, blockIds: ["b1"] }));
}

describe("getSpeakerCandidates", () => {
    // The property the whole `#` interaction rests on: there is always something to take, so Enter
    // and Tab never have to mean anything different.
    it("always offers the typed name, so the list is never empty", () => {
        const candidates = getSpeakerCandidates([], [], "Zoe");
        expect(candidates).toEqual([{ key: "name:Zoe", kind: "temp", name: "Zoe" }]);
    });

    it("is empty only when nothing is typed and nothing exists", () => {
        expect(getSpeakerCandidates([], [], "")).toEqual([]);
    });

    it("puts real characters first, so the default highlight prefers them", () => {
        const candidates = getSpeakerCandidates([alice], temps("Alfred"), "Al");

        expect(candidates.map(candidate => candidate.name)).toEqual(["Alice", "Alfred", "Al"]);
        expect(candidates[0].kind).toBe("character");
    });

    it("does not offer the typed name a second time when it already matches", () => {
        const candidates = getSpeakerCandidates([alice], [], "Alice");
        expect(candidates).toHaveLength(1);
        expect(candidates[0].kind).toBe("character");
    });

    it("offers previously-used names back, which is how a name is findable later", () => {
        const candidates = getSpeakerCandidates([], temps("Narrator's friend"), "friend");
        expect(candidates.map(candidate => candidate.name)).toEqual(["Narrator's friend", "friend"]);
    });

    it("does not let a temp speaker shadow a real character of the same name", () => {
        const candidates = getSpeakerCandidates([alice], temps("Alice"), "");
        expect(candidates).toHaveLength(1);
        expect(candidates[0].kind).toBe("character");
    });

    it("filters both kinds by the query", () => {
        const candidates = getSpeakerCandidates([alice, bob], temps("Carol"), "bo");
        expect(candidates.map(candidate => candidate.name)).toEqual(["Bob", "bo"]);
    });
});
