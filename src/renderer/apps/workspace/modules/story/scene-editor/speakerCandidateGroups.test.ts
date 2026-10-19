import { describe, expect, it } from "vitest";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterProfile } from "@/lib/workspace/services/character/CharacterProfile";
import { groupSpeakerCandidates, type GroupableSpeakerCandidate } from "./speakerCandidateGroups";

function candidate(id: string, name: string, groupId?: string): GroupableSpeakerCandidate & { name: string } {
    const profile = CharacterProfile.create(id, name);
    profile.setGroupId(groupId);
    return { key: id, kind: "character", character: Character.fromJSON({ profile: profile.toJSON() }), name };
}

function temp(name: string): GroupableSpeakerCandidate & { name: string } {
    return { key: `name:${name}`, kind: "temp", name };
}

const npc = new Map([["g-npc", "NPC"]]);

describe("groupSpeakerCandidates", () => {
    it("lists the ungrouped cast first, then each group under its name", () => {
        const grouped = groupSpeakerCandidates([candidate("a", "A", "g-npc"), candidate("b", "B")], npc);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["B", "A"]);
        expect(grouped.headers.get("a")).toBe("NPC");
        expect(grouped.headers.has("b")).toBe(false);
    });

    it("keeps the group list's own order, and heads only the groups with a member on show", () => {
        const groups = new Map([["g-1", "Chapter one"], ["g-2", "Chapter two"]]);
        const grouped = groupSpeakerCandidates([candidate("b", "B", "g-2"), candidate("a", "A", "g-1")], groups);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["A", "B"]);
        expect([...grouped.headers.values()]).toEqual(["Chapter one", "Chapter two"]);
    });

    it("leaves bare names at the end, where the name being typed has to stay", () => {
        const grouped = groupSpeakerCandidates([candidate("a", "Al", "g-npc"), temp("Alfred"), temp("Al")], npc);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["Al", "Alfred", "Al"]);
        expect(grouped.ordered[grouped.ordered.length - 1].kind).toBe("temp");
    });

    // A group deleted while the picker is open, and a project with no groups at all, are the same
    // case: nothing is filed, so the order is exactly the one the candidates arrived in.
    it("files a character whose group is gone with the ungrouped, in the order given", () => {
        const grouped = groupSpeakerCandidates([candidate("a", "A", "g-dropped"), candidate("b", "B")], npc);

        expect(grouped.ordered.map(entry => entry.name)).toEqual(["A", "B"]);
        expect(grouped.headers.size).toBe(0);
    });
});
